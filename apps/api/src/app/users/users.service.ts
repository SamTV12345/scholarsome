import { Injectable } from "@nestjs/common";
import { PrismaService } from "../providers/database/prisma/prisma.service";
import { User, Prisma } from "@prisma/client";
import { Request } from "express";
import jwt_decode from "jwt-decode";

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  /**
   * Decodes the access token JWT
   *
   * @param req User's `Request` object
   *
   * @returns Decoded access token
   */
  getUserInfo(req: Request): false | { id: string; email: string; } {
    if (req.cookies["access_token"]) {
      return jwt_decode(req.cookies["access_token"]);
    } else return false;
  }

  /**
   * Queries the database for a unique user
   *
   * @param userWhereUniqueInput Prisma `UserWhereUniqueInput` selector
   *
   * @returns Queried `User` object
   */
  async user(
      userWhereUniqueInput: Prisma.UserWhereUniqueInput
  ): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: userWhereUniqueInput
    });
  }

  /**
   * Queries the database for multiple users
   *
   * @param params.skip Optional, Prisma skip selector
   * @param params.take Optional, Prisma take selector
   * @param params.cursor Optional, Prisma cursor selector
   * @param params.where Optional, Prisma where selector
   * @param params.orderBy Optional, Prisma orderBy selector
   *
   * @returns Array of queried `User` objects
   */
  async users(params: {
    skip?: number;
    take?: number;
    cursor?: Prisma.UserWhereUniqueInput;
    where?: Prisma.UserWhereInput;
    orderBy?: Prisma.UserOrderByWithRelationInput;
  }): Promise<User[]> {
    const { skip, take, cursor, where, orderBy } = params;
    return this.prisma.user.findMany({
      skip,
      take,
      cursor,
      where,
      orderBy
    });
  }

  /**
   * Creates a user in the database
   *
   * @param data Prisma `UserCreateInput` selector
   *
   * @returns Created `User` object
   */
  async createUser(data: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.create({
      data
    });
  }

  /**
   * Updates a user in the database
   *
   * @param params.where Prisma where selector
   * @param params.data Prisma data selector
   *
   * @returns Updated `User` object
   */
  async updateUser(params: {
    where: Prisma.UserWhereUniqueInput;
    data: Prisma.UserUpdateInput;
  }): Promise<User> {
    const { where, data } = params;
    return this.prisma.user.update({
      data,
      where
    });
  }


  /**
   * Deletes a user from the database
   *
   * @param where Prisma `UserWhereUniqueInput` selector
   *
   * @returns `User` object that was deleted
   */
  async deleteUser(where: Prisma.UserWhereUniqueInput): Promise<User> {
    return this.prisma.user.delete({
      where
    });
  }
}