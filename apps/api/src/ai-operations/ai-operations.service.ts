import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@/generated/prisma';
import { PrismaService } from '../prisma/prisma.service';

type NoShowRiskTier = 'LOW' | 'MEDIUM' | 'HIGH';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatInsightTitle(insightType: string, dayOfWeek: number, timeSlot: Date): string {
  const day = DAY_NAMES[dayOfWeek] ?? `Day ${dayOfWeek}`;
  const hour = timeSlot.getUTCHours();
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${insightType.replace(/_/g, ' ')} — ${day} ${displayHour}${ampm}`;
}

function insightPriority(metricValue: { toNumber(): number }): 'HIGH' | 'MEDIUM' | 'LOW' {
  const v = metricValue.toNumber();
  if (v >= 0.7) return 'HIGH';
  if (v >= 0.4) return 'MEDIUM';
  return 'LOW';
}

function formatMetricKey(key: string): string {
  return key
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function computePercentile(value: number, p25: number, p50: number, p75: number): number {
  if (value <= p25) return Math.round((value / Math.max(p25, 0.001)) * 25);
  if (value <= p50) return Math.round(25 + ((value - p25) / Math.max(p50 - p25, 0.001)) * 25);
  if (value <= p75) return Math.round(50 + ((value - p50) / Math.max(p75 - p50, 0.001)) * 25);
  return Math.min(99, Math.round(75 + ((value - p75) / Math.max(p75, 0.001)) * 24));
}

function getRiskTier(score: Prisma.Decimal): NoShowRiskTier {
  const val = score.toNumber();
  if (val >= 0.6) return 'HIGH';
  if (val >= 0.3) return 'MEDIUM';
  return 'LOW';
}

@Injectable()
export class AiOperationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSlotDemandInsights(tenantId: string) {
    const now = new Date();
    const insights = await this.prisma.slotDemandInsight.findMany({
      where: {
        tenantId,
        isDismissed: false,
        expiresAt: { gt: now },
      },
      orderBy: { computedAt: 'desc' },
    });

    return insights.map((i) => ({
      id: i.id,
      type: i.insightType,
      title: formatInsightTitle(i.insightType, i.dayOfWeek, i.timeSlot),
      description: i.recommendation,
      priority: insightPriority(i.metricValue),
      data: { dayOfWeek: i.dayOfWeek, timeSlot: i.timeSlot, metricValue: Number(i.metricValue) },
      createdAt: i.computedAt,
    }));
  }

  async dismissInsight(tenantId: string, insightId: string, userId: string) {
    const insight = await this.prisma.slotDemandInsight.findFirst({
      where: { id: insightId, tenantId },
    });

    if (!insight) {
      throw new NotFoundException('Insight not found');
    }

    return this.prisma.slotDemandInsight.update({
      where: { id: insightId },
      data: { isDismissed: true, dismissedBy: userId },
    });
  }

  async getClientRisk(tenantId: string, clientId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: {
        tenantId,
        clientId,
        status: 'CONFIRMED',
        startTime: { gt: new Date() },
        noShowRiskScore: { not: null },
      },
      orderBy: { startTime: 'asc' },
      select: {
        id: true,
        startTime: true,
        noShowRiskScore: true,
        service: { select: { name: true } },
      },
    });

    if (!booking || !booking.noShowRiskScore) {
      return { bookingId: null, riskScore: null, riskTier: null };
    }

    return {
      bookingId: booking.id,
      startTime: booking.startTime,
      serviceName: booking.service.name,
      riskScore: booking.noShowRiskScore,
      riskTier: getRiskTier(booking.noShowRiskScore),
    };
  }

  async getClientRebooking(tenantId: string, clientId: string) {
    const profile = await this.prisma.clientProfile.findUnique({
      where: { tenantId_clientId: { tenantId, clientId } },
      select: { rebookingIntervalDays: true, optimalReminderLeadHours: true },
    });

    return {
      rebookingIntervalDays: profile?.rebookingIntervalDays ?? null,
      optimalReminderLeadHours: profile?.optimalReminderLeadHours ?? null,
    };
  }

  async getBenchmarks(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { category: true, benchmarkOptOut: true },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    if (tenant.benchmarkOptOut) {
      return [];
    }

    const benchmarks = await this.prisma.categoryBenchmark.findMany({
      where: { businessCategory: tenant.category },
      orderBy: { metricKey: 'asc' },
    });

    if (!benchmarks.length) return [];

    const tenantValue = await this.computeTenantMetrics(tenantId);

    return benchmarks.map((b) => {
      const value = tenantValue[b.metricKey] ?? 0;
      return {
        metric: formatMetricKey(b.metricKey),
        value,
        industryAverage: Number(b.p50),
        percentile: computePercentile(value, Number(b.p25), Number(b.p50), Number(b.p75)),
      };
    });
  }

  private async computeTenantMetrics(tenantId: string): Promise<Record<string, number>> {
    const [bookingStats] = await this.prisma.$queryRaw<Array<{
      avg_monthly_bookings: number;
      avg_revenue_per_booking: number;
      completion_rate: number;
    }>>`
      SELECT
        COALESCE(COUNT(*)::float / NULLIF(
          EXTRACT(EPOCH FROM (NOW() - MIN(start_time))) / 2592000.0, 0
        ), 0) AS avg_monthly_bookings,
        COALESCE(AVG(CASE WHEN status = 'COMPLETED' THEN total_amount END), 0) AS avg_revenue_per_booking,
        COALESCE(
          COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END)::float /
          NULLIF(COUNT(*), 0), 0
        ) AS completion_rate
      FROM bookings
      WHERE tenant_id = ${tenantId}
    `;

    return {
      avg_monthly_bookings: Number(bookingStats?.avg_monthly_bookings ?? 0),
      avg_revenue_per_booking: Number(bookingStats?.avg_revenue_per_booking ?? 0),
      completion_rate: Number(bookingStats?.completion_rate ?? 0),
    };
  }
}
