import { Controller, Get } from '@nestjs/common';
import { Public } from './modules/auth/requester';

@Controller('health')
@Public()
export class HealthController {
  @Get()
  health() {
    return { status: 'ok', service: 'core-platform-backend', uptime_seconds: Math.round(process.uptime()) };
  }
}
