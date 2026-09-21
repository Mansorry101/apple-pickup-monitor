#!/usr/bin/env bash
# Apple 取货监控 —— macOS / Linux 一键部署
#
#   chmod +x deploy.sh && ./deploy.sh
#
# 部署后会以 systemd（Linux）或 launchd（macOS）常驻后台运行，
# 不占用终端、不弹窗口。若都没有，则回退到 nohup 后台运行。

set -euo pipefail
cd "$(dirname "$0")"
PROJECT_DIR="$(pwd)"

echo ""
echo "=================================================="
echo "   Apple 取货监控 - 一键部署"
echo "   监控 iPhone 18 Pro Max 512GB 银/黑 @ 广东道"
echo "=================================================="
echo ""

# ---------- 1. 检查 Node ----------
if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 没有检测到 Node.js"
  echo "  macOS : brew install node     或  https://nodejs.org"
  echo "  Ubuntu: sudo apt install nodejs npm"
  exit 1
fi
echo "[环境] Node.js $(node -v)  ($(command -v node))"

# ---------- 2. 依赖 ----------
echo ""
echo "[1/3] 安装依赖..."
if [ -d node_modules ]; then
  echo "    依赖已存在，跳过。"
else
  npm install --no-audit --no-fund
fi

# ---------- 3. 邮箱配置 ----------
echo ""
echo "[2/3] 配置邮箱..."
if [ -f .env ]; then
  echo "    已配置过，跳过（如需修改：node src/setup.js）"
else
  node src/setup.js
fi

# ---------- 4. 注册后台服务 ----------
echo ""
echo "[3/3] 注册后台服务..."
NODE_BIN="$(command -v node)"

if [[ "$(uname -s)" == "Linux" ]] && command -v systemctl >/dev/null 2>&1; then
  UNIT=/etc/systemd/system/apple-pickup-monitor.service
  echo "    使用 systemd: $UNIT"
  if [ ! -w /etc/systemd/system ]; then
    echo "    需要 sudo 权限写入 systemd 单元..."
  fi
  sed "s|__PROJECT_DIR__|$PROJECT_DIR|g; s|__NODE_BIN__|$NODE_BIN|g; s|__USER__|$USER|g" \
    scripts/apple-pickup-monitor.service | sudo tee "$UNIT" >/dev/null
  sudo systemctl daemon-reload
  sudo systemctl enable --now apple-pickup-monitor
  echo "    已启动。"
  echo ""
  echo "  查看状态: sudo systemctl status apple-pickup-monitor"
  echo "  查看日志: tail -f \"$PROJECT_DIR/monitor.log\""
  echo "    （或 sudo journalctl -u apple-pickup-monitor -f）"
  echo "  停止监控: sudo systemctl stop apple-pickup-monitor"
  echo "  卸载    : sudo systemctl disable --now apple-pickup-monitor"

elif [[ "$(uname -s)" == "Darwin" ]]; then
  PLIST="$HOME/Library/LaunchAgents/com.apple-pickup-monitor.plist"
  echo "    使用 launchd: $PLIST"
  sed "s|__PROJECT_DIR__|$PROJECT_DIR|g; s|__NODE_BIN__|$NODE_BIN|g" \
    scripts/com.apple-pickup-monitor.plist > "$PLIST"
  launchctl unload -w "$PLIST" 2>/dev/null || true
  launchctl load -w "$PLIST"
  echo "    已启动。"
  echo ""
  echo "  查看状态: launchctl list | grep pickup"
  echo "  查看日志: tail -f \"$PROJECT_DIR/monitor.log\""
  echo "  停止监控: launchctl unload -w \"$PLIST\""
  echo "  卸载    : launchctl unload -w \"$PLIST\" && rm \"$PLIST\""

else
  # 回退：nohup 后台运行
  echo "    未检测到 systemd/launchd，使用 nohup 后台运行。"
  if [ -f monitor.pid ] && kill -0 "$(cat monitor.pid)" 2>/dev/null; then
    echo "    已有实例在运行（PID $(cat monitor.pid)），先停止。"
    kill "$(cat monitor.pid)" 2>/dev/null || true
    sleep 1
  fi
  nohup "$NODE_BIN" src/index.js >> monitor.log 2>&1 &
  echo $! > monitor.pid
  echo "    已启动，PID $(cat monitor.pid)。"
  echo ""
  echo "  查看日志: tail -f \"$PROJECT_DIR/monitor.log\""
  echo "  停止监控: kill \$(cat \"$PROJECT_DIR/monitor.pid\")"
  echo "  注意：这种方式重启电脑后不会自动启动。"
fi

echo ""
echo "=================================================="
echo "   部署完成，程序已在后台运行"
echo "   有货时会自动发邮件通知你。"
echo "=================================================="
echo ""
