import {
  Controller, Post, Body, Headers, Logger, HttpStatus, HttpCode, Req,
  UnauthorizedException, ConflictException, RawBodyRequest,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { ApplicationsService } from '../applications/applications.service';
import { DeploymentsService } from '../deployments/deployments.service';
import { Public } from '../auth/requester';

// GitHub has no login token: requests are checked with GITHUB_WEBHOOK_SECRET instead.
@Controller('webhooks')
@Public()
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);
  private warnedNoSecret = false;

  constructor(
    private readonly applicationsService: ApplicationsService,
    private readonly deploymentsService: DeploymentsService,
  ) {}

  /** Verify GitHub's X-Hub-Signature-256 when GITHUB_WEBHOOK_SECRET is configured. */
  private verifySignature(rawBody: Buffer | undefined, signature: string | undefined) {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) {
      if (!this.warnedNoSecret) {
        this.logger.warn('GITHUB_WEBHOOK_SECRET is not set - webhook requests are NOT authenticated.');
        this.warnedNoSecret = true;
      }
      return;
    }
    if (!rawBody || !signature) throw new UnauthorizedException('Missing webhook signature');
    const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException('Invalid webhook signature');
  }

  @Post('github')
  @HttpCode(HttpStatus.OK)
  async handleGithubWebhook(
    @Req() req: RawBodyRequest<any>,
    @Body() payload: any,
    @Headers('x-github-event') event: string,
    @Headers('x-hub-signature-256') signature: string,
  ) {
    this.verifySignature(req.rawBody, signature);
    this.logger.log(`Received GitHub webhook event: ${event}`);

    if (event === 'ping') return { message: 'pong' };
    if (event !== 'push') return { message: `Ignored event: ${event}` };

    const ref: string = typeof payload?.ref === 'string' ? payload.ref : '';
    if (!ref.startsWith('refs/heads/')) return { message: `Ignored non-branch ref: ${ref || '(none)'}` };
    if (payload.deleted) return { message: 'Ignored branch deletion' };

    const branch = ref.slice('refs/heads/'.length);
    const cloneUrl: string = payload.repository?.clone_url || payload.repository?.html_url || '';
    const commitSha: string = payload.head_commit?.id || payload.after || 'webhook-push';
    const commitMessage: string = payload.head_commit?.message || 'Triggered by GitHub push webhook';

    this.logger.log(`GitHub push on ${cloneUrl} (branch: ${branch}, commit: ${commitSha})`);

    const app = this.applicationsService.findApplicationByRepo(cloneUrl, branch);
    if (!app) {
      this.logger.warn(`No registered application matches ${cloneUrl} @ ${branch}`);
      return { message: 'No matching application registered for this repository and branch' };
    }

    try {
      const deployment = await this.deploymentsService.triggerDeployment(app.id, commitSha, commitMessage);
      return {
        message: `Automated deployment triggered for app ${app.name}`,
        deployment_id: deployment.id,
        status: deployment.status,
      };
    } catch (err) {
      if (err instanceof ConflictException) {
        return { message: `A deployment of ${app.name} is already running; this push was not queued` };
      }
      throw err;
    }
  }
}
