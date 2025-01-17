import { Controller, Get, NotFoundException, Param, Request, Res } from "@nestjs/common";
import { Request as ExpressRequest, Response } from "express";
import { UsersService } from "../users/users.service";
import { ConfigService } from "@nestjs/config";
import { SetsService } from "../sets/sets.service";
import { GetObjectCommandOutput } from "@aws-sdk/client-s3";
import * as fs from "fs";
import * as path from "path";
import { S3 } from "@aws-sdk/client-s3";
import { SetIdAndFileParam } from "@scholarsome/shared";

@Controller("media")
export class MediaController {
  constructor(
    private readonly usersService: UsersService,
    private readonly setsService: SetsService,
    private readonly configService: ConfigService
  ) {}

  @Get("/sets/:setId/:file")
  async getFile(@Param() params: SetIdAndFileParam, @Request() req: ExpressRequest, @Res({ passthrough: true }) res: Response) {
    const set = await this.setsService.set({
      id: params.setId
    });
    if (!set) throw new NotFoundException();

    if (set.private) {
      const userCookie = this.usersService.getUserInfo(req);

      if (!userCookie) throw new NotFoundException();
      if (set.authorId !== userCookie.id) throw new NotFoundException();
    }

    if (
      this.configService.get<string>("STORAGE_TYPE") === "s3" ||
      this.configService.get<string>("STORAGE_TYPE") === "S3"
    ) {
      let file: GetObjectCommandOutput;

      const s3 = await new S3({
        credentials: {
          accessKeyId: this.configService.get<string>("S3_STORAGE_ACCESS_KEY"),
          secretAccessKey: this.configService.get<string>("S3_STORAGE_SECRET_KEY")
        },
        endpoint: this.configService.get<string>("S3_STORAGE_ENDPOINT"),
        region: this.configService.get<string>("S3_STORAGE_REGION")
      });

      try {
        file = await s3.getObject({
          Key: "media/sets/" + params.setId + "/" + params.file,
          Bucket: this.configService.get<string>("S3_STORAGE_BUCKET")
        });
      } catch (e) {
        throw new NotFoundException();
      }

      res.writeHead(200, {
        "Content-Type": "image/" + params.file.split(".").pop()
      });

      res.write(await file.Body.transformToByteArray());
    }

    if (this.configService.get<string>("STORAGE_TYPE") === "local") {
      const filePath = path.join(this.configService.get<string>("STORAGE_LOCAL_DIR"), "media", "sets", params.setId, params.file);

      if (fs.existsSync(filePath)) {
        res.writeHead(200, {
          "Content-Type": "image/" + params.file.split(".").pop()
        });

        res.write(fs.readFileSync(filePath));

        res.end();
      } else {
        throw new NotFoundException();
      }
    }
  }
}
