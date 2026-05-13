export default {
  fetch() {
    return new Response("capsule preview example ok\n", {
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }
};
