import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
  Request,
  Res,
  UseGuards
} from "@nestjs/common";
import { UsersService } from "../users/users.service";
import { AuthService } from "./auth.service";
import { Response, Request as ExpressRequest } from "express";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { ApiResponse, LoginDto, RegisterDto, ResetPasswordDto } from "@scholarsome/shared";
import * as jwt from "jsonwebtoken";
import { ConfigService } from "@nestjs/config";
import * as bcrypt from "bcrypt";
import { MailService } from "../providers/mail/mail.service";
import { RedisService } from "@liaoliaots/nestjs-redis";
import Redis from "ioredis";
import { JwtService } from "@nestjs/jwt";
import { User } from "@prisma/client";

@UseGuards(ThrottlerGuard)
@Controller("auth")
export class AuthController {
  private readonly redis: Redis;

  /**
   * @ignore
   */
  constructor(
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService
  ) {
    this.redis = this.redisService.getClient();
  }

  /*
  * Password reset routes
  */

  /**
   * Resets the password of a user after checking for a valid reset token in their cookies.
   *
   * @returns Whether the user's password was successfully updated
   */
  @Post("reset/setPassword")
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto, @Res({ passthrough: true }) res: Response, @Req() req: ExpressRequest): Promise<ApiResponse<User>> {
    let decoded: { email: string, reset: boolean };

    try {
      decoded = jwt.verify(req.cookies["resetPasswordToken"], this.configService.get<string>("JWT_SECRET")) as { email: string, reset: boolean };
    } catch (e) {
      res.status(401);

      return {
        status: "fail",
        message: "Invalid reset token"
      };
    }

    if (!decoded || !decoded.reset) {
      res.status(401);

      return {
        status: "fail",
        message: "Invalid reset token"
      };
    }

    res.cookie("resetPasswordToken", "", { httpOnly: false, expires: new Date() });

    const query = await this.usersService.updateUser({
      where: {
        email: decoded.email
      },
      data: {
        password: await bcrypt.hash(resetPasswordDto.password, 10)
      }
    });

    return {
      status: "success",
      data: query
    };
  }

  /**
   * Adds a reset token in cookies that can be used in the /api/auth/reset/password route to reset a password.
   *
   * @remarks This is the link that is emailed to users when a password reset is requested.
   * @returns Void, redirect to /api/auth/redirect
   */
  @Get("reset/password/setCookie/:token")
  async setResetCookie(@Param() params: { token: string }, @Res() res: Response): Promise<void> {
    let decoded: { email: string, reset: boolean };
    try {
      decoded = jwt.verify(params.token, this.configService.get<string>("JWT_SECRET")) as { email: string, reset: boolean };
    } catch (e) {
      return res.redirect("/");
    }

    if (decoded && decoded.reset) {
      res.cookie("resetPasswordToken", params.token, { httpOnly: false, expires: new Date(new Date().setMinutes(new Date().getMinutes() + 10)) });
    }

    return res.redirect("/");
  }

  /**
   * Sends a password reset for a given user
   *
   * @remarks Throttled to 5 requests per minute
   * @returns Call to send a password reset email
   */
  @Throttle(5, 600)
  @Get("reset/sendReset/:email")
  async sendReset(@Param() params: { email: string }): Promise<ApiResponse<null>> {
    const user = await this.usersService.user({ email: params.email });

    if (user && !user.verified) {
      await this.mailService.sendPasswordReset(params.email);
    }

    return {
      status: "success",
      data: null
    };
  }

  /*
  * Registration routes
  */

  /**
   * Verifies a users email given a successfully validated token
   *
   * @remarks This is the link that users click on to verify their email
   * @returns Void, redirect to '/'
   */
  @Get("verify/email/:token")
  async verifyEmail(@Param() params: { token: string }, @Res() res: Response) {
    let email: { email: string };

    try {
      email = jwt.verify(params.token, this.configService.get<string>("JWT_SECRET")) as { email: string };
    } catch (e) {
      return {
        status: "fail",
        message: "Invalid token"
      };
    }
    if (!email) {
      return {
        status: "fail",
        message: "Invalid token"
      };
    }

    const verification = await this.usersService.updateUser({
      where: {
        email: email.email
      },
      data: {
        verified: true
      }
    });

    if (verification) {
      res.cookie("verified", true, { expires: new Date(new Date().setSeconds(new Date().getSeconds() + 30)) });
    } else {
      res.cookie("verified", false, { expires: new Date() });
    }

    const user = await this.usersService.user({ email: email.email });
    if (!user) res.redirect("/");

    this.authService.setLoginCookies(res, user);

    return res.redirect("/homepage");
  }

  /**
   * Resends the verification email to the user
   */
  @Post("resendVerification")
  async resendVerificationMail(@Request() req: ExpressRequest): Promise<ApiResponse<null>> {
    const userCookie = this.usersService.getUserInfo(req);
    if (!userCookie) {
      return {
        status: "fail",
        message: "Something went wrong!"
      };
    }

    const user = await this.usersService.user({ id: userCookie.id });

    if (user) {
      if (await this.mailService.sendEmailConfirmation(user.email)) {
        return {
          status: "success",
          data: null
        };
      } else {
        return {
          status: "fail",
          message: "Could not send verification email - is SMTP configured?"
        };
      }
    } else {
      return {
        status: "fail",
        message: "Something went wrong."
      };
    }
  }


  /**
   * Registers a new user
   *
   * @remarks Throttled to 1 request per 15 minutes
   * @returns Void, HTTP 201 if successful email confirmation, 200 if email disabled
   */
  @Throttle(5, 900)
  @Post("register")
  async register(@Body() registerDto: RegisterDto, @Res({ passthrough: true }) res: Response): Promise<ApiResponse<null>> {
    if (
      await this.usersService.user({ email: registerDto.email }) ||
      await this.usersService.user({ username: registerDto.username })
    ) {
      res.status(409);

      return {
        status: "fail",
        message: "Email already exists"
      };
    } else {
      const user = await this.usersService.createUser({
        username: registerDto.username,
        email: registerDto.email,
        password: await bcrypt.hash(registerDto.password, 10),
        verified: !this.configService.get<boolean>("SMTP_HOST")
      });

      await this.mailService.sendEmailConfirmation(registerDto.email);
      this.authService.setLoginCookies(res, user);

      return {
        status: "success",
        data: null
      };
    }
  }

  /*
  * Login routes
  */

  /**
   * Logs a user in and sets relevant cookies
   *
   * @returns Void, HTTP 200 if successful
   */
  @HttpCode(200)
  @Post("login")
  async login(@Body() loginDto: LoginDto, @Res({ passthrough: true }) res: Response): Promise<ApiResponse<null>> {
    if (!(await this.authService.validateUser(loginDto.email, loginDto.password))) {
      res.status(401);

      return {
        status: "fail",
        message: "Incorrect email or password"
      };
    }

    if (this.configService.get<string>("SCHOLARSOME_RECAPTCHA_SECRET")) {
      const captchaCheck = await this.authService.validateRecaptcha(loginDto.recaptchaToken);
      if (!captchaCheck) throw new HttpException("Too many requests", HttpStatus.TOO_MANY_REQUESTS);
    }


    const user = await this.usersService.user({
      email: loginDto.email
    });

    if (!user) {
      res.status(500);

      return {
        status: "error",
        message: "Error finding user"
      };
    }

    this.authService.setLoginCookies(res, user);

    return {
      status: "success",
      data: null
    };
  }

  /**
   * Logs a user out and removes relevant cookies
   *
   * @returns Void
   */
  @Post("logout")
  logout(@Req() req: ExpressRequest, @Res({ passthrough: true }) res: Response) {
    return this.authService.logout(req, res);
  }
}
