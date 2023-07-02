import Emittery from "emittery";

import { UserError } from "./user";

type UserErrorEvents = {
  error: { error: UserError };
};

export class UserErrorService extends Emittery<UserErrorEvents> {
  hasUserError = false;

  submitUserError({ error }: { error: UserError }) {
    this.hasUserError = true;
    this.emit("error", { error });
  }
}
