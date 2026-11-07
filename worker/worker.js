export default {
  async fetch(request, env) {
    const configured = Boolean(env.FIREBASE_SERVICE_ACCOUNT);

    return new Response(JSON.stringify({
      service: "KardShot Boosters",
      status: configured ? "configured" : "missing_secret"
    }), {
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
};

