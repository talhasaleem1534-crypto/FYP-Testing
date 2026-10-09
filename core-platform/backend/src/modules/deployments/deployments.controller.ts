import { Controller, Post, Get, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { DeploymentsService } from './deployments.service';
import { CurrentRequester, Requester } from '../auth/requester';

@Controller()
export class DeploymentsController {
  constructor(private readonly deploymentsService: DeploymentsService) {}

  @Post('applications/:id/deploy')
  @HttpCode(HttpStatus.ACCEPTED)
  async deployApplication(@Param('id') id: string, @CurrentRequester() r: Requester) {
    const deployment = await this.deploymentsService.triggerDeployment(id, undefined, undefined, r);
    return {
      deployment_id: deployment.id,
      app_name: deployment.app_name,
      status: deployment.status,
      stream_url: `/deployments/${deployment.id}/logs/ws`,
    };
  }

  @Post('applications/by-name/:name/deploy')
  @HttpCode(HttpStatus.ACCEPTED)
  async deployApplicationByName(@Param('name') name: string, @CurrentRequester() r: Requester) {
    const deployment = await this.deploymentsService.triggerDeployment(name, undefined, undefined, r);
    return {
      deployment_id: deployment.id,
      app_name: deployment.app_name,
      status: deployment.status,
      stream_url: `/deployments/${deployment.id}/logs/ws`,
    };
  }

  @Get('deployments')
  async listDeployments(@CurrentRequester() r: Requester) {
    return this.deploymentsService.getAllDeployments(r);
  }

  @Get('deployments/:id')
  async getDeployment(@Param('id') id: string, @CurrentRequester() r: Requester) {
    return this.deploymentsService.getDeploymentById(id, r);
  }

  @Get('applications/:id/deployments')
  async getDeploymentsForApp(@Param('id') id: string, @CurrentRequester() r: Requester) {
    return this.deploymentsService.getDeploymentsByApp(id, r);
  }
}
