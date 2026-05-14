# Privacy Policy

**Effective date:** 14 May 2026
**Last updated:** 14 May 2026

This Privacy Policy explains how personal data is, and is not, handled in connection with the Chui Wallet browser extension and any related software, builds, source code, and documentation (collectively, the "**Software**").

The Software is published by **OneByZero Tech Pte Ltd**, 61 Robinson Road, #07-06, Singapore 068893 ("**we**", "**us**", "**our**"). In this Policy, "**you**" or "**User**" means a natural person who installs or uses the Software.

## 1. Summary

Read this first if you read nothing else:

- We **do not** operate any backend service, login, account system, or user database.
- We **do not** collect, transmit, store, sell, share, broker, profile, or monetise any personal data on any server we control.
- We **do not** embed any analytics, telemetry, crash reporter, A/B-testing, advertising, attribution, fingerprinting, or third-party tracker in the Software.
- The Software runs entirely inside your browser. Your seed phrase, password, account list, and preferences live on your device and are not transmitted to us.
- The Software does, however, cause your browser to talk directly to third-party blockchain data providers in order to function. Those providers will see your network address (IP) and the queries your browser makes (for example, which Bitcoin or Ethereum addresses you are looking up). They are operated independently of us.

This Policy explains those statements in detail.

## 2. Scope

This Policy covers the Software. It does not cover:

- the browser you run the Software in (governed by your browser vendor's privacy policy);
- the operating system and device you run the browser on;
- the Third-Party Services (defined below) the Software contacts;
- decentralised applications, smart contracts, or counterparties you interact with using the Software;
- the Chrome Web Store or any other distribution channel through which you may have obtained the Software (governed by that channel's policies);
- any chat, email, forum, or repository where you separately contact us.

## 3. Who is the data controller

For data protection purposes (including the Singapore Personal Data Protection Act 2012 ("**PDPA**"), the EU General Data Protection Regulation 2016/679 ("**GDPR**"), and the UK GDPR), **OneByZero Tech Pte Ltd is the data controller** in respect of any personal data that we cause to be processed. Because the Software is client-side and we do not operate any server that receives user data, the scope of personal data we control is extremely narrow. See clause 4.

For data processed by Third-Party Services as a result of your use of the Software, those Third-Party Services act as independent controllers in respect of the data they receive. We are not their processor and they are not ours.

## 4. What we collect

**We do not collect personal data through the Software.** Specifically:

  (a) The Software does not contain any analytics, telemetry, error-reporting, performance-monitoring, advertising, attribution, or fingerprinting library.
  (b) The Software does not "phone home". It does not send your IP, device identifier, installation identifier, version string, or usage events to any endpoint operated by us.
  (c) We do not operate any server, API, or database that receives data from the Software. We have no logs, sessions, accounts, or records of you as a User.
  (d) We do not place any cookie or use any browser-storage mechanism (`localStorage`, `IndexedDB`, etc.) on websites you visit through the Software.
  (e) The Software's source repository is public. You may verify the absence of telemetry by reading the source and inspecting the network requests in your browser's developer tools.

If you separately choose to contact us (by email, repository issue, or otherwise), we will receive whatever personal data you voluntarily send us in that message. That contact data is processed only to respond to your enquiry and is described in clause 9.

## 5. Data the Software handles locally on your device

The Software stores the following on your device, using your browser's built-in `chrome.storage.local` and `chrome.storage.session` APIs. This data does **not** leave your device unless your browser, operating system, or another application transmits it (for example, via a browser sync feature you have enabled, a cloud backup of your profile directory, or malware).

### 5.1 Persistent storage (`chrome.storage.local`)

This data survives a browser restart. It is removed when you uninstall the Software.

| Data | Storage key | How it is protected |
|---|---|---|
| Encrypted vault containing your BIP-39 mnemonic and/or BIP-32 extended private key | `wallet` | Encrypted with a symmetric key derived from your password using PBKDF2-SHA-256 with **600,000 iterations** and a random salt, then sealed with AES-256-GCM. Your password itself is not written to `chrome.storage.local`. |
| Account metadata (account names, derivation index, network, chain, extended public key, derived addresses) | `accounts` | Plain JSON. Treat it as sensitive: it does not contain private keys but it does reveal the addresses you own. |
| Preferences (gap limits, locale, fiat currency, active account index, active network) | `preferences` | Plain JSON. Not sensitive on its own. |
| Optional caches that speed up the wallet (block headers, transaction history, balances) | various | Plain JSON. Derived from public chain data. |

### 5.2 Session storage (`chrome.storage.session`)

This data lives only in browser memory. It is automatically cleared when the browser closes or when the extension's service worker is terminated by the browser, and it is **not** copied into any persisted profile, sync, or cloud backup.

While you are unlocked, the Software keeps a short-lived copy of your password and a session encryption key in `chrome.storage.session` so it can sign transactions without re-prompting you for the password on every action.

| Data | Storage key | How it is protected |
|---|---|---|
| Session copy of your password | internal opaque key (currently `8C7822A5D65E99D67FDE93E344AF9`) | Encrypted with AES-256-GCM using a per-session key (see next row). Expires after **1 hour** or when you lock or log out, whichever is sooner. |
| Per-session AES-256-GCM key, used only to wrap the session password | internal opaque key | Random 256-bit key generated at the start of each session and held in `chrome.storage.session` for the lifetime of the session. Never written to `chrome.storage.local` and never transmitted. |

If you do not want a session copy held in memory, lock the wallet or close your browser before stepping away.

If you uninstall the Software, the browser deletes both `chrome.storage.local` and `chrome.storage.session` data owned by the Software. If you have not previously backed up your mnemonic, your vault will no longer be recoverable.

We have no way to access, read, copy, decrypt, reset, or recover any of this local data. We cannot recover lost passwords or mnemonics.

## 6. Network requests the Software makes

To function as a wallet, the Software causes your browser to make network requests from your device directly to third parties that index, broadcast, price, or otherwise serve blockchain data ("**Third-Party Services**"). We do not proxy these requests. We do not see them.

Each Third-Party Service will typically observe:

  (a) your **IP address**;
  (b) request **timing** and frequency;
  (c) the **content** of the request (for example, an Electrum script-hash lookup reveals which Bitcoin address or `xpub` you are checking; an Ethereum `eth_getBalance` call reveals which address you are checking);
  (d) any **HTTP headers** your browser sends, such as `User-Agent`.

Each Third-Party Service has its own privacy policy. We are not their agent and they are not ours. We do not control what they log, how long they retain it, or whom they share it with.

As of the effective date above, Third-Party Services contacted by default or by configuration include the following. The list may change as the Software evolves; the canonical list is the source code.

| Purpose | Endpoints (non-exhaustive) |
|---|---|
| Bitcoin chain queries and tx broadcast | Electrum servers (configurable in preferences); `blockstream.info` block explorer API |
| Bitcoin fee estimation | `mempool.space`, `api.blockchain.info/mempool/fees` |
| Bitcoin price (fiat) | `www.blockonomics.co/api/price` |
| Generic price feed | `api.coingecko.com` |
| Ethereum RPC | `ethereum-rpc.publicnode.com`, `mainnet.infura.io`, `ethereum-sepolia-rpc.publicnode.com`, `sepolia.infura.io` |
| Ethereum chain queries and block explorer | `eth.blockscout.com`, `eth-sepolia.blockscout.com` |
| UI fonts (CSS + font files) | `fonts.googleapis.com`, `fonts.gstatic.com` |

Privacy considerations:

  (a) **IP exposure.** Every Third-Party Service the Software contacts will see your IP address. If you do not want a Third-Party Service to associate your IP with your wallet addresses, you can route the browser through a VPN, Tor, or an `xpub`-isolating workflow at your own discretion.
  (b) **Address-cluster exposure.** A single Third-Party Service that handles many of your queries can correlate your addresses into a cluster owned by the same User. You can mitigate this by running your own Electrum server, switching servers, or using independent wallets per use case.
  (c) **Google Fonts.** Loading the UI font causes requests to Google-operated font domains (`fonts.googleapis.com` for the stylesheet and `fonts.gstatic.com` for the font files). Google may receive your IP address, the requested font URL, and standard HTTP headers such as `User-Agent` and `Referer`. Google publicly states it does not use Google Fonts data to profile end users or for targeted advertising; we relay that statement and cannot verify it. If you object, you can block these domains at the browser, host, or network level; the wallet will still function with a fallback system font.

## 7. Permissions the Software requests

When installed, the Software requests the following Chrome extension permissions. We list them so you can decide whether to grant them.

| Permission | Why the Software requests it |
|---|---|
| `storage` | To persist the encrypted vault, account list, and preferences in `chrome.storage.local` on your device. |
| `alarms` | To schedule periodic, low-frequency background tasks such as rebalance scans. |
| `host_permissions: <all_urls>` | To inject the Chui Wallet provider (`window.chuiWallet`) into web pages so that decentralised applications can request the User's `xpub` or addresses (after explicit User approval). The provider only exposes read methods (`getXpub`, `getAddresses`, `getXpubAddresses`); it does not silently sign or transfer funds. The Software does not read page content beyond what is necessary to expose the provider object. |

We do **not** request the `tabs`, `cookies`, `webRequest`, `clipboardRead`, `clipboardWrite`, `geolocation`, `notifications`, `nativeMessaging`, or `identity` extension permissions.

The Software does, however, use two browser APIs that do not require their own permission entry:

  (a) `navigator.clipboard.writeText()`: invoked only when you press a Copy button (for example, to copy an address, `xpub`, or mnemonic to the clipboard at your own request). The Software does not read the clipboard.
  (b) `chrome.tabs.create()`: invoked only to open links you click (for example, opening a transaction in a block explorer, or the Terms of Use / Privacy Policy in a new tab). The Software does not enumerate, query, or modify your existing tabs.

## 8. dApp interactions

When you visit a website that detects the Chui Wallet provider and asks for your `xpub` or addresses:

  (a) The website's request is handled inside your browser by the Software. It is not relayed to us.
  (b) The Software will surface a prompt asking for your approval before any address or extended public key is returned.
  (c) If you approve, the Software returns the requested data to that specific page's origin only.
  (d) Approvals are stored locally in your `chrome.storage.local`. They are not visible to us.

You are responsible for evaluating each dApp before approving it. Approving a malicious site may expose your address graph to that site.

## 9. If you contact us

If you separately email us, file an issue on the source repository, or otherwise contact us, we will receive whatever you include in your message (typically your email address, repository username, IP address as seen by the email/issue host, and the content of your message). We process this contact data only to:

  (a) respond to your enquiry;
  (b) investigate and address security or legal issues;
  (c) comply with applicable law.

We retain contact data only as long as is reasonably necessary for those purposes. We do not use it for marketing.

## 10. Children

The Software is not intended for, directed at, or designed for use by individuals under the age of 18 (or the higher age of legal capacity in your jurisdiction). We do not knowingly collect personal data from minors. If you believe a minor has provided us with personal data, contact us at the address in clause 14 and we will take reasonable steps to delete it.

## 11. International transfers

Because we do not operate a server that receives user data from the Software, no data transfer is initiated by us. When the Software contacts Third-Party Services, the data leaves your device and travels directly to those services, which may be located anywhere in the world. We have no influence over where those servers are or where data is processed.

For any contact data you voluntarily send us (clause 9), processing takes place in Singapore.

## 12. Your rights

Subject to applicable law (including the PDPA, GDPR, UK GDPR, and other data protection laws), you may have the following rights in respect of personal data we control:

  (a) the right to access the data we hold about you;
  (b) the right to rectify inaccurate data;
  (c) the right to erase data ("right to be forgotten");
  (d) the right to restrict or object to processing;
  (e) the right to data portability;
  (f) the right to withdraw consent where processing relies on consent;
  (g) the right to lodge a complaint with a supervisory authority (such as the Personal Data Protection Commission of Singapore, the data protection authority in your EU/UK country, or the equivalent in your jurisdiction).

In practice, because we do not collect any personal data through the Software, there is rarely anything for us to access, correct, port, or delete. Where you have contacted us directly (clause 9), you may exercise these rights against the limited contact data we hold by writing to the address in clause 14.

## 13. Security

We use cryptographic primitives chosen with current best practice in mind (PBKDF2-SHA-256 with 600,000 iterations to derive the vault key from your password; authenticated symmetric encryption to seal the vault). No security measure is perfect. You acknowledge that:

  (a) the security of your wallet depends on the strength of your password and the secrecy of your mnemonic;
  (b) a compromised device, a compromised browser, or a malicious extension installed alongside the Software can defeat the wallet's protections;
  (c) cryptographic primitives may be weakened over time, including by advances in quantum computing;
  (d) we do not warrant that the Software is free of vulnerabilities. See the Terms of Use for the full disclaimer.

If you believe you have found a security vulnerability in the Software, please report it responsibly via the contact address in clause 14 rather than disclosing it publicly.

## 14. Contact

For privacy and data-protection matters:

> Privacy contact
> OneByZero Tech Pte Ltd
> 61 Robinson Road, #07-06
> Singapore 068893
> Email: privacy@chuiwallet.com

For security vulnerability reports:

> Security contact
> OneByZero Tech Pte Ltd
> 61 Robinson Road, #07-06
> Singapore 068893
> Email: security@chuiwallet.com

Do **not** post seed phrases, private keys, passwords, personal data, or vulnerability details in a public source-repository issue or any other public forum. Use the email addresses above so the report stays private.

## 15. Changes to this Policy

We may revise this Policy from time to time. The current version is always available in the Software's source repository. The "Effective date" at the top of this document marks when the current version took effect. By continuing to use the Software after a revised version is published, you accept the revised Policy. If you do not accept a revision, stop using the Software.
