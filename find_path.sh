#!/bin/bash

#================================================
# Termux Path Finder for Tanki Online Resources
# Version 2.1 - Corrected Level-by-Level Scanning Logic
#================================================

# --- 配置 ---
BASE_URL="https://res.3dtank.com"

# --- 帮助函数 ---

# 使用bc进行安全的十进制到八进制转换
to_octal() {
    [[ "$1" =~ ^[0-9]+$ ]] && echo "obase=8; $1" | bc || echo "0"
}

# 使用bc进行无符号右移 (ushr)
ushr() { echo "$1 / (2^$2)" | bc; }

# 从一个完整的ID中提取特定层级的值 (0-indexed: 0,1,2,3)
get_level_val() {
    local id=$1
    local level=$2 # Level 0, 1, 2, or 3
    local val=0
    case $level in
        0) val=$(ushr $id 32) ;;
        1) local low32=$(echo "$id % (2^32)" | bc); val=$(ushr $low32 16) ;;
        2) local low32=$(echo "$id % (2^32)" | bc); val=$(echo "($low32 % (2^16)) / 256" | bc) ;;
        3) val=$(echo "$id % 256" | bc) ;;
    esac
    echo $val
}

# 颜色代码
C_GREEN="\033[32m"
C_YELLOW="\033[33m"
C_BLUE="\033[34m"
C_RED="\033[31m"
C_RESET="\033[0m"

# --- 检查输入 ---
if [ "$#" -ne 2 ]; then
    echo -e "${C_RED}错误: 需要提供两个ID作为参数。${C_RESET}"
    echo "用法: ./find_path.sh <起始ID> <结束ID>"
    exit 1
fi

START_ID=$1
END_ID=$2
# 确保START_ID < END_ID
if (($(echo "$START_ID > $END_ID" | bc -l))); then
    t=$START_ID; START_ID=$END_ID; END_ID=$t
fi

echo -e "${C_BLUE}--- ID 到 4级路径查找器 v2.1 (修复版逐级扫描) ---${C_RESET}"
echo "服务器: $BASE_URL"
echo "ID 范围: $START_ID -> $END_ID"
echo ""

# --- 核心查找函数 ---
# 这是一个递归函数，逐级向下查找
# 参数: $1=当前级别(1-4), $2=已找到的路径前缀
find_path_recursive() {
    local level=$1
    local current_path=$2
    local level_idx=$((level - 1)) # 将1-4转换为0-3的索引

    # --- 动态计算当前级别的扫描范围 ---
    # 这是此脚本的核心修正点
    local min_val max_val

    # 获取起始ID和结束ID在当前级别上的理论值
    local start_level_val=$(get_level_val $START_ID $level_idx)
    local end_level_val=$(get_level_val $END_ID $level_idx)
    
    # 获取当前已找到路径在理论上的起始和结束值
    local current_path_start_val=""
    local current_path_end_val=""
    if [ -n "$current_path" ]; then
        # 从 START_ID 和 END_ID 重建到上一级为止的路径
        local theoretical_start_path=""
        local theoretical_end_path=""
        for i in $(seq 0 $((level_idx - 1))); do
            theoretical_start_path+="$(to_octal $(get_level_val $START_ID $i))/"
            theoretical_end_path+="$(to_octal $(get_level_val $END_ID $i))/"
        done
        # 去掉末尾的斜杠
        theoretical_start_path=${theoretical_start_path%/}
        theoretical_end_path=${theoretical_end_path%/}
        
        # 判断当前我们正在扫描的路径是属于起始段、中间段还是结束段
        if [ "$current_path" == "$theoretical_start_path" ]; then
            min_val=$start_level_val # 在起始路径上，从起始ID的对应值开始
        else
            min_val=0 # 在中间路径上，从0开始
        fi

        if [ "$current_path" == "$theoretical_end_path" ]; then
            max_val=$end_level_val # 在结束路径上，到结束ID的对应值结束
        else
            # 根据级别确定最大值
            case $level_idx in
                0|1) max_val=65535 ;; # 16-bit
                2|3) max_val=255 ;;   # 8-bit
            esac
        fi
    else # 如果是第一级
        min_val=$start_level_val
        max_val=$end_level_val
    fi
    
    echo -e "${C_YELLOW}--- 正在探测第 ${level} 级 (范围: ${min_val} -> ${max_val}) ---${C_RESET}"

    for i in $(seq $min_val $max_val); do
        local path_part=$(to_octal $i)
        local test_path="$path_part"
        if [ -n "$current_path" ]; then
            test_path="$current_path/$path_part"
        fi
        
        local url_to_check="$BASE_URL/$test_path/"
        
        printf "检查: %-55s ... " "$url_to_check"
        local http_code=$(curl --head -L --connect-timeout 10 -o /dev/null -s -w "%{http_code}" "$url_to_check")
        
        if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 403 ]; then
            echo -e "${C_GREEN}找到! (状态: $http_code)${C_RESET}"
            
            if [ "$level" -eq 4 ]; then
                echo ""
                echo -e "${C_GREEN}🎉🎉🎉 成功找到完整路径! 🎉🎉🎉${C_RESET}"
                echo -e "${C_BLUE}最终路径是: ${C_RESET}${test_path}"
                return 0 # 返回成功
            else
                # 递归查找下一级
                find_path_recursive $((level + 1)) "$test_path"
                # 如果递归调用成功（找到了最终路径），则立即一路返回成功
                if [ $? -eq 0 ]; then
                    return 0
                fi
            fi
        else
            echo "失败 (状态: $http_code)"
        fi
        sleep 0.2 # 轻微延迟以防屏蔽
    done
    
    echo -e "${C_RED}错误: 在第 ${level} 级的指定范围内未找到有效路径。${C_RESET}"
    return 1 # 返回失败
}

# --- 从第一级开始启动查找 ---
find_path_recursive 1 ""

if [ $? -ne 0 ]; then
    echo ""
    echo -e "${C_RED}扫描完成，但在指定的ID范围 [${START_ID}-${END_ID}] 内未能构建出一条完整的有效路径。${C_RESET}"
fi