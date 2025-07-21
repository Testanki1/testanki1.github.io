#!/data/data/com.termux/files/usr/bin/bash
# =====================================================================
# Termux 脚本: 批量查找 Tanki Online 的 meta.info 文件 (v3.1 - 顺序递增模式)
# 作者: AI
# 描述: 根据用户需求，将 v3.0 的中心扩展搜索模式修改为严格的顺序递增模式。
#       脚本会从指定的起始编号开始，逐个向上查找，直到找到文件为止。
#       仍然采用分批次并行处理以提高效率。
# =====================================================================

# --- 配置区 ---
BASE_URL="https://s.eu.tankionline.com/627/130231/355/322"
# 搜索的起始八进制编号
start_number_oct="31366046474423"
# PARALLEL_JOBS 代表每个“批次”的大小
PARALLEL_JOBS=50
# 修改后的代码
LOCK_FILE="${TMPDIR:-/tmp}/tanki_finder.lock"

# --- 脚本主体 ---
start_number_dec=$((8#$start_number_oct))

echo "🚀 脚本启动 (顺序递增并行模式 v3.1)..."
echo "八进制起始编号: ${start_number_oct}"
echo "十进制起始编号: ${start_number_dec}"
echo "每批次任务数:   ${PARALLEL_JOBS}"
echo "=================================================="
echo "将从起始编号开始，顺序向上搜索..."
echo "=================================================="

# --- 函数定义 ---

# 检查 URL 的函数，在后台静默运行
check_url() {
  local number_dec_to_check=$1
  local base_url_arg=$2
  local lock_file_arg=$3

  # 如果锁文件已存在，则此任务无需执行，直接退出
  if [ -f "${lock_file_arg}" ]; then
    exit 1
  fi
  
  local number_oct_to_check=$(printf '%o' "$number_dec_to_check")
  local target_url="${base_url_arg}/${number_oct_to_check}/meta.info"
  
  local http_status=$(curl -L -s -o /dev/null -w "%{http_code}" --max-time 10 "${target_url}")
  
  if [ "${http_status}" -eq 200 ]; then
    echo -e "\n\n\n=================================================="
    echo "🎉🎉🎉 文件找到！🎉🎉🎉"
    echo "   URL: ${target_url}"
    echo "   八进制: ${number_oct_to_check} (十进制: ${number_dec_to_check})"
    echo "==================================================\n\n"
    # 创建锁文件，通知主进程和其他任务停止
    touch "${lock_file_arg}"
    exit 0
  fi
  exit 1
}

export -f check_url
export BASE_URL
export LOCK_FILE

# 清理函数，在脚本退出时终止所有子进程
cleanup() {
  echo -e "\n🛑 正在清理和终止所有剩余的检测任务..."
  # pkill 的 -P $$ 会终止所有由当前 shell 启动的子进程
  pkill -P $$ &>/dev/null 
  rm -f "${LOCK_FILE}"
  echo "✅ 清理完毕。"
  exit 0
}

trap cleanup EXIT INT TERM

# 确保开始时没有锁文件
rm -f "${LOCK_FILE}"

# --- 主循环 (顺序递增并行调度器) ---

# 定义当前要检查的十进制数，从用户设定的起始值开始
current_number_dec=$start_number_dec
batch_num=1

while true; do
  # 在开始一个新批次前，检查是否已经找到了目标
  if [ -f "${LOCK_FILE}" ]; then
    echo "✅ 目标已在上一批次中找到，脚本即将退出。"
    break
  fi

  echo "--- 派发第 ${batch_num} 批次 (共 ${PARALLEL_JOBS} 个任务) ---"

  # 1. 派发一个完整的批次
  for (( i=0; i<PARALLEL_JOBS; i++ )); do
    # 要检查的数字就是当前数字
    number_to_check_dec=$current_number_dec
    
    number_oct_to_check=$(printf '%o' "$number_to_check_dec")
    echo "[派发] ${BASE_URL}/${number_oct_to_check}/meta.info"
    check_url "$number_to_check_dec" "$BASE_URL" "$LOCK_FILE" &
    
    # 为下一个任务准备，将数字加一
    ((current_number_dec++))
  done

  # 2. 等待当前批次的所有后台任务完成
  echo "--- 第 ${batch_num} 批次已派发完毕，等待所有任务完成... ---"
  wait
  echo "--- 第 ${batch_num} 批次检测完成。---"
  echo "" # 增加一个空行，让输出更清晰
  
  ((batch_num++))
done

# 最后的等待和清理工作由 trap 自动处理
echo "脚本执行完毕。"
