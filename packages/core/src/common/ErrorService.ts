import Emittery from "emittery";

type ErrorServiceEvents = {
  handlerError: { error: Error };
  handlerErrorCleared: undefined;
};

export class ErrorService extends Emittery<ErrorServiceEvents> {
  isHandlerError = false;

  submitHandlerError({ error }: { error: Error }) {
    this.isHandlerError = true;
    this.emit("handlerError", { error });
  }

  clearHandlerError() {
    this.isHandlerError = false;
    this.emit("handlerErrorCleared");
  }
}
