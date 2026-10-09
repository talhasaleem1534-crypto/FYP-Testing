import { Controller, Post, Get, Patch, Delete, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { ServersService } from './servers.service';
import { CreateServerDto } from './dto/create-server.dto';
import { PlatformKeyService } from './platform-key.service';
import { AdminOnly, CurrentRequester, Requester } from '../auth/requester';

class ShareServerDto {
  @IsBoolean()
  shared: boolean;
}

@Controller('servers')
export class ServersController {
  constructor(private readonly serversService: ServersService, private readonly platformKey: PlatformKeyService) {}

  /** The platform's PUBLIC key and the commands to prepare a Linux server ("Add a server" page). */
  @Get('platform-key')
  platformKeyInfo() {
    return this.platformKey.info();
  }

  /** The admin adds shared servers; a customer adds their own private server. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async registerServer(@Body() dto: CreateServerDto, @CurrentRequester() r: Requester) {
    return this.serversService.createServer(dto, r);
  }

  @Get()
  async listServers(@CurrentRequester() r: Requester) {
    return this.serversService.getServersFor(r);
  }

  @Get(':id')
  async getServer(@Param('id') id: string, @CurrentRequester() r: Requester) {
    // Public variant: the stored SSH private key must never leave the server.
    return this.serversService.getPublicServerFor(id, r);
  }

  @Post(':id/verify')
  @HttpCode(HttpStatus.OK)
  async verifyServer(@Param('id') id: string, @CurrentRequester() r: Requester) {
    return this.serversService.verifyServer(id, r);
  }

  /** Admin: allow / stop customers deploying to this server. */
  @Patch(':id')
  @AdminOnly()
  setShared(@Param('id') id: string, @Body() dto: ShareServerDto) {
    return this.serversService.setShared(id, dto.shared);
  }

  @Delete(':id')
  deleteServer(@Param('id') id: string, @CurrentRequester() r: Requester) {
    return this.serversService.deleteServer(id, r);
  }
}
