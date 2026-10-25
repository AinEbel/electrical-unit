# Electrical Assistant: AI server setup

The AI features run through a small private server, a free Cloudflare Worker. The Anthropic key is stored there as a secret. It never appears in the web page, in GitHub or in the Firebase database. The server only answers people who are signed in with a verified email and are on the Electrical Unit team.

You do this once, and it takes about 10 minutes.

## 1. Get an Anthropic API key

1. Go to https://console.anthropic.com and sign in (or create an account).
2. Under **Billing**, add a payment method and some credit.
3. Open **API Keys**, choose **Create Key**, name it `electrical-assistant` and copy the key. It starts with `sk-ant-`.

## 2. Create the Cloudflare Worker

1. Go to https://dash.cloudflare.com and sign up (the free plan is enough).
2. Open **Workers & Pages**, choose **Create**, then **Create Worker**.
3. Name it `electrical-assistant-ai` and choose **Deploy**.
4. Choose **Edit code**. Delete everything in the editor, then paste the full contents of [`worker.js`](worker.js).
5. Choose **Deploy**.

## 3. Add the key as a secret

1. In the Worker, open **Settings**, then **Variables and Secrets**, then **Add**.
2. Set the type to **Secret**, the name to `ANTHROPIC_API_KEY`, and paste your key as the value.
3. Choose **Deploy**.

## 4. Connect the app

1. Copy the Worker address shown on its page, for example `https://electrical-assistant-ai.yourname.workers.dev`.
2. Open https://ainebel.github.io/electrical-unit/assistant/ and sign in as the supervisor.
3. Open **Admin**, paste the address in **AI server address**, then choose **Save** and **Test**.

## Firestore rules

The **Admin** page also shows the Firestore rules for the assistant's data. Copy them into the Firebase console under **Firestore Database**, then **Rules**. Put them inside `match /databases/{database}/documents { ... }`, next to your existing rules, and choose **Publish**.

## Costs and limits

- Each answer is billed to your Anthropic account. You can set a monthly spend limit in the Anthropic console under **Limits**.
- To cut off AI access at any time, delete the secret or the Worker. The rest of the app keeps working.
