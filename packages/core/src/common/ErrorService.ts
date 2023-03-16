import Emittery from "emittery";

type ErrorServiceEvents = {
  handlerError: { context: string; error: Error };
  handlerErrorCleared: undefined;
};

export class ErrorService extends Emittery<ErrorServiceEvents> {
  isHandlerError = false;

  submitHandlerError({ context, error }: { context: string; error: Error }) {
    this.isHandlerError = true;
    this.emit("handlerError", { context, error });
  }

  clearHandlerError() {
    this.isHandlerError = false;
    this.emit("handlerErrorCleared");
  }
}
