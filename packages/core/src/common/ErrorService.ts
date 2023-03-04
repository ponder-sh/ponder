import { EventEmitter } from "@/common/EventEmitter";

type ErrorServiceEvents = {
  handlerError: (arg: { context: string; error: Error }) => void;
  handlerErrorCleared: () => void;
};

export class ErrorService extends EventEmitter<ErrorServiceEvents> {
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
