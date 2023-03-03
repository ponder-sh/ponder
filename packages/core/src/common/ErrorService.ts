import { EventEmitter } from "@/common/EventEmitter";

type ErrorServiceEvents = {
  handlerError: (arg: { error: Error }) => void;
  handlerErrorCleared: () => void;
};

export class ErrorService extends EventEmitter<ErrorServiceEvents> {
  isHandlerError = false;

  submitHandlerError(error: Error) {
    this.isHandlerError = true;
    this.emit("handlerError", { error });
  }

  clearHandlerError() {
    this.isHandlerError = false;
    this.emit("handlerErrorCleared");
  }
}
