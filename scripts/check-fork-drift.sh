#!/bin/bash
# Fork 漂移审计 — 派生项目本地跑,检查跟 upstream 的差异
#
# 用法:
#   ./scripts/check-fork-drift.sh                  # 默认对比 upstream/main
#   ./scripts/check-fork-drift.sh upstream/dev     # 指定 ref
#
# 输出三类:
#   - MODIFIED  改了 upstream 已有的文件 → ⚠ 回流候选,review 是否要发 upstream PR
#   - ADDED     新增的派生项目文件 → 通常是业务,但 review 一遍排除"漏回流"的基座组件
#   - DELETED   派生项目删的文件 → ⚠ review 是否要在 upstream 也删,还是只是本地不要
#
# 目的:fork-style 派生模式下,改了 upstream 文件 git 不会提醒,长期累积变成回流债务。
# 这个脚本作为本地审计,每次 sprint / 大功能完成后跑一遍。

set -e
cd "$(dirname "$0")/.."

UPSTREAM_REF="${1:-upstream/main}"

if ! git rev-parse --verify "$UPSTREAM_REF" >/dev/null 2>&1; then
    # 没有 upstream remote = 当前是 upstream 本身(framework/admin),不是派生项目。静默退出,不报错。
    # 派生项目应该有 upstream remote;如果你期望有但没有:
    #   git remote add upstream git@gitlab.saibo.club:saibo/framework/sb-framework-admin.git
    #   git fetch upstream
    exit 0
fi

echo "=== Fork 漂移审计 — HEAD vs $UPSTREAM_REF ==="
echo ""

# 过滤:派生项目特有的、不需要 review 的文件
EXCLUDE_GLOBS=(
    ':!pnpm-lock.yaml'
    ':!.env.development'
    ':!.env.production'
    ':!CHANGELOG.md'
    ':!README.md'
    ':!CLAUDE.md'
    ':!apps/web-antd/vite.config.mts'
)

MOD=$(git diff --name-only --diff-filter=M "$UPSTREAM_REF" HEAD -- "${EXCLUDE_GLOBS[@]}" 2>/dev/null)
ADD=$(git diff --name-only --diff-filter=A "$UPSTREAM_REF" HEAD -- "${EXCLUDE_GLOBS[@]}" 2>/dev/null)
DEL=$(git diff --name-only --diff-filter=D "$UPSTREAM_REF" HEAD -- "${EXCLUDE_GLOBS[@]}" 2>/dev/null)

MOD_COUNT=$(echo -n "$MOD" | grep -c '^' || echo 0)
ADD_COUNT=$(echo -n "$ADD" | grep -c '^' || echo 0)
DEL_COUNT=$(echo -n "$DEL" | grep -c '^' || echo 0)

echo "📊 概览"
echo "  Modified : $MOD_COUNT  ← ⚠ 回流候选(改了 upstream 文件)"
echo "  Added    : $ADD_COUNT  ← 派生新增(通常业务,review 排除漏沉)"
echo "  Deleted  : $DEL_COUNT  ← ⚠ 派生删除(review 是否上游也该删)"
echo ""

if [ "$MOD_COUNT" -gt 0 ]; then
    echo "⚠️  MODIFIED — 改了 upstream 文件,大概率应该回流:"
    echo "$MOD" | sed 's/^/  /'
    echo ""
fi

if [ "$DEL_COUNT" -gt 0 ]; then
    echo "⚠️  DELETED — 派生项目删了 upstream 文件:"
    echo "$DEL" | sed 's/^/  /'
    echo ""
fi

if [ "$ADD_COUNT" -gt 0 ]; then
    echo "ℹ️  ADDED — 派生项目新增(滚动查看,挑选是否有应该上沉的通用组件):"
    echo "$ADD" | sed 's/^/  /' | head -50
    if [ "$ADD_COUNT" -gt 50 ]; then
        echo "  ... 还有 $((ADD_COUNT - 50)) 个文件(只显示前 50)"
    fi
    echo ""
fi

echo "---"
echo "Review 流程:"
echo "  1. 看 MODIFIED 每个文件的 diff:  git diff $UPSTREAM_REF HEAD -- <path>"
echo "  2. 真通用 fix/feature → 在 upstream 仓库提 MR"
echo "  3. 业务耦合或者派生项目特定 → 留在本地,无需回流"
echo "  4. ADDED 里如果有"看着不像业务"的通用组件/工具,也评估上沉"
