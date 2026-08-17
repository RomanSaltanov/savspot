import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { TenantRoles } from '../common/decorators/tenant-roles.decorator';
import { TenantRolesGuard } from '../common/guards/tenant-roles.guard';
import { UuidValidationPipe } from '../common/pipes/uuid-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('Workflow Automations')
@ApiBearerAuth()
@Controller('tenants/:tenantId/workflows')
@UseGuards(TenantRolesGuard)
export class WorkflowAutomationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @TenantRoles('OWNER', 'ADMIN')
  async list(@Param('tenantId', UuidValidationPipe) tenantId: string) {
    const automations = await this.prisma.workflowAutomation.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });

    return automations.map((a) => ({
      id: a.id,
      name: (a.actionConfig as Record<string, unknown>)?.description ?? a.triggerEvent,
      triggerEvent: a.triggerEvent,
      actions: [{ type: a.actionType, config: a.actionConfig }],
      active: a.isActive,
      createdAt: a.createdAt.toISOString(),
      lastTriggeredAt: null,
    }));
  }

  @Post()
  @TenantRoles('OWNER')
  async create(
    @Param('tenantId', UuidValidationPipe) tenantId: string,
    @Body() body: { name: string; triggerEvent: string; active?: boolean },
  ) {
    const automation = await this.prisma.workflowAutomation.create({
      data: {
        tenantId,
        triggerEvent: body.triggerEvent as any,
        actionType: 'SEND_NOTIFICATION',
        actionConfig: { description: body.name },
        isActive: body.active ?? true,
      },
    });

    return {
      id: automation.id,
      name: body.name,
      triggerEvent: automation.triggerEvent,
      actions: [{ type: automation.actionType, config: automation.actionConfig }],
      active: automation.isActive,
      createdAt: automation.createdAt.toISOString(),
      lastTriggeredAt: null,
    };
  }

  @Patch(':id')
  @TenantRoles('OWNER')
  async update(
    @Param('tenantId', UuidValidationPipe) _tenantId: string,
    @Param('id', UuidValidationPipe) id: string,
    @Body() body: { name?: string; triggerEvent?: string; active?: boolean },
  ) {
    const automation = await this.prisma.workflowAutomation.update({
      where: { id },
      data: {
        ...(body.triggerEvent && { triggerEvent: body.triggerEvent as any }),
        ...(body.active !== undefined && { isActive: body.active }),
        ...(body.name && {
          actionConfig: { description: body.name },
        }),
      },
    });

    return {
      id: automation.id,
      name: (automation.actionConfig as Record<string, unknown>)?.description ?? automation.triggerEvent,
      triggerEvent: automation.triggerEvent,
      actions: [{ type: automation.actionType, config: automation.actionConfig }],
      active: automation.isActive,
      createdAt: automation.createdAt.toISOString(),
      lastTriggeredAt: null,
    };
  }

  @Delete(':id')
  @TenantRoles('OWNER')
  async remove(
    @Param('tenantId', UuidValidationPipe) _tenantId: string,
    @Param('id', UuidValidationPipe) id: string,
  ) {
    await this.prisma.workflowAutomation.delete({ where: { id } });
    return { success: true };
  }
}
