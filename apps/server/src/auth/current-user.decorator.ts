import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { CurrentUser } from "@ktv/contracts";
import type { Request } from "express";

export interface AuthenticatedRequest extends Request {
  currentUser: CurrentUser;
}

export const CurrentUserParam = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentUser =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().currentUser,
);
