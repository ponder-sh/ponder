export class UserErrorService {
  hasUserError = false;

  submitUserError() {
    this.hasUserError = true;
  }
}
