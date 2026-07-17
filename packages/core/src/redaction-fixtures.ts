// Fake, non-functional credential-shaped values for redaction tests only.
// None of these are real secrets. Every value contains the marker "FAKE" and
// must never be used to authenticate against any real service. They exist so
// tests can assert that Capsule redaction catches each credential shape on the
// default redaction profile.

export interface RedactionFixture {
  name: string;
  value: string;
  description: string;
}

export const redactionFixtureTokens: RedactionFixture[] = [
  {
    name: "bearer",
    value: "Bearer FAKE-not-a-real-token-value",
    description: "Authorization header carrying a bearer token."
  },
  {
    name: "stripeLiveKey",
    value: "sk_live_FAKEFAKEFAKEFAKEFAKE00",
    description: "Provider live secret key prefix."
  },
  {
    name: "stripeTestKey",
    value: "sk_test_FAKEFAKEFAKEFAKEFAKE00",
    description: "Provider test secret key prefix."
  },
  {
    name: "githubToken",
    value: "ghp_FAKEFAKEFAKEFAKEFAKEFAKE00",
    description: "GitHub personal access token prefix."
  },
  {
    name: "slackToken",
    value: "xoxb-FAKEFAKEFAKEFAKEFAKEFAKE-fake",
    description: "Slack bot token prefix."
  },
  {
    name: "jwt",
    value: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkZBS0UifQ.eyJzdWIiOiJGQUtFIn0.ZmFrZXNpZ25hdHVyZXZhbHVl",
    description: "JSON Web Token with fake header, payload, and signature."
  }
];

// Sample object with sensitive keys and credential-shaped values for testing
// object-graph redaction. All values are fake.
export const redactionFixtureObject = {
  apiKey: "FAKE-api-key-value",
  authorization: "Bearer FAKE-not-a-real-token-value",
  nested: {
    password: "FAKE-not-a-real-password",
    token: "sk_live_FAKEFAKEFAKEFAKEFAKE00"
  },
  safe: "this-value-is-safe-and-must-survive-redaction"
};
