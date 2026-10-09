import { Controller, Post, Get, Delete, Body, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApplicationsService } from './applications.service';
import { CreateApplicationDto, ScaleApplicationDto } from './dto/create-application.dto';
import { CurrentRequester, Requester } from '../auth/requester';

@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createApplication(@Body() dto: CreateApplicationDto, @CurrentRequester() r: Requester) {
    return this.applicationsService.present(await this.applicationsService.createApplication(dto, r));
  }

  @Get()
  async listApplications(@CurrentRequester() r: Requester) {
    return this.applicationsService.getApplicationsFor(r).map(a => this.applicationsService.present(a));
  }

  // NOTE: the more specific `by-name/...` routes must be declared before the
  // catch-all `:id` route so they can never be shadowed by it.
  @Get('by-name/:name/status')
  async getApplicationStatusByName(@Param('name') name: string, @CurrentRequester() r: Requester) {
    const app = this.applicationsService.getApplicationFor(name, r);
    return {
      app_name: app.name,
      status: app.status,
      domain: app.domain,
      replicas: app.replicas,
      latest_deployment: {
        commit_sha: app.current_commit_sha || null,
        status: app.status,
        deployed_at: app.last_deployed_at || null,
      },
    };
  }

  @Post('by-name/:name/scale')
  @HttpCode(HttpStatus.OK)
  async scaleApplicationByName(@Param('name') name: string, @Body() dto: ScaleApplicationDto, @CurrentRequester() r: Requester) {
    return this.applicationsService.scaleApplication(name, dto, r);
  }

  @Delete('by-name/:name')
  async deleteApplicationByName(@Param('name') name: string, @CurrentRequester() r: Requester, @Query('force') force?: string) {
    return this.applicationsService.deleteApplication(name, force === 'true', r);
  }

  @Get(':id')
  async getApplication(@Param('id') id: string, @CurrentRequester() r: Requester) {
    return this.applicationsService.present(this.applicationsService.getApplicationFor(id, r));
  }

  @Delete(':id')
  async deleteApplication(@Param('id') id: string, @CurrentRequester() r: Requester, @Query('force') force?: string) {
    return this.applicationsService.deleteApplication(id, force === 'true', r);
  }

  @Post(':id/scale')
  @HttpCode(HttpStatus.OK)
  async scaleApplicationById(@Param('id') id: string, @Body() dto: ScaleApplicationDto, @CurrentRequester() r: Requester) {
    return this.applicationsService.scaleApplication(id, dto, r);
  }
}
