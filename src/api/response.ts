export default class HttpResponse {
  static json<T>(data: T, status = 200) {
    return Response.json(data, { status });
  }

  static error(message: string, status = 500) {
    return this.json(
      {
        error: message,
      },
      status,
    );
  }

  static notFound(message = "Not found") {
    return this.error(message, 404);
  }

  static unauthorized(message = "Unauthorized") {
    return this.error(message, 401);
  }
}
