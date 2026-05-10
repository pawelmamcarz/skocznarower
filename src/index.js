export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname === 'skocznarower.pl') {
      url.hostname = 'www.skocznarower.pl';
      return Response.redirect(url.toString(), 301);
    }

    return env.ASSETS.fetch(request);
  }
};
