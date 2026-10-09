import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, HttpStatus, Post, Req, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from './auth.dto';
import { isLoopback, Public } from './requester';

/**
 * Accounts. The browser keeps the returned access_token and sends it back as
 * `Authorization: Bearer <token>`. Customers sign up on the customer portal; the single
 * admin account is created once, on the admin laptop (setup-admin).
 */
@Controller('auth')
@Public()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  /** Lets the admin site know whether it should show "create the admin account" or "sign in". */
  @Get('status')
  status(@Req() req: any) {
    return { admin_exists: this.auth.hasAdmin(), on_admin_laptop: isLoopback(req.socket?.remoteAddress) };
  }

  /** First-time setup: create the admin account. Only from the admin laptop, only once. */
  @Post('setup-admin')
  @HttpCode(HttpStatus.CREATED)
  setupAdmin(@Body() dto: RegisterDto, @Req() req: any) {
    if (!isLoopback(req.socket?.remoteAddress)) {
      throw new ForbiddenException('The admin account can only be created on the admin laptop (open http://localhost:5173/admin there).');
    }
    return this.auth.setupAdmin(dto);
  }

  /** Who is signed in? 401 when the token is missing, wrong or expired. */
  @Get('me')
  me(@Headers('authorization') authorization?: string) {
    const user = this.auth.userFromAuthHeader(authorization);
    if (!user) throw new UnauthorizedException('Not signed in');
    return this.auth.publicUser(user);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Headers('authorization') authorization?: string) {
    return this.auth.logout(authorization);
  }
}
