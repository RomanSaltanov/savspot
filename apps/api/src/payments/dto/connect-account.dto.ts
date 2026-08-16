import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ConnectAccountDto {
  @ApiPropertyOptional({
    example: 'GB',
    description:
      'ISO 3166-1 alpha-2 country code. Defaults to the tenant profile country.',
  })
  @IsString()
  @IsOptional()
  country?: string;
}
