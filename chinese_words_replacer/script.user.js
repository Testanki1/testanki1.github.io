// ==UserScript==
// @name         3D坦克国服屏蔽词替换器
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  自动将3D坦克国服聊天框中的敏感词替换为和谐版本，绕过聊天屏蔽。字典从外部URL加载。
// @author       Testanki
// @match        *://*.3dtank.com/play*
// @grant        GM_xmlhttpRequest
// @connect      testanki1.github.io
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    let replacementDict = {};
    let sortedKeys = [];

    /**
     * 从指定的URL获取替换字典
     */
    function fetchDictionary() {
        console.log('开始获取3D坦克替换字典...');
        GM_xmlhttpRequest({
            method: 'GET',
            url: 'https://testanki1.github.io/chinese_words_replacer/dictionary.json',
            onload: function(response) {
                if (response.status >= 200 && response.status < 300) {
                    try {
                        replacementDict = JSON.parse(response.responseText);
                        // 关键步骤：将字典的键（要被替换的词）按长度降序排序
                        // 这样可以确保优先替换长词，避免长词被短词的替换规则破坏
                        // 例如，确保 "轰炸机" 先于 "机" 被替换
                        sortedKeys = Object.keys(replacementDict).sort((a, b) => b.length - a.length);
                        console.log('3D坦克 屏蔽词替换字典加载成功！');
                    } catch (e) {
                        console.error('3D坦克 屏蔽词替换字典解析失败:', e);
                    }
                } else {
                    console.error('3D坦克 屏蔽词替换字典下载失败，状态码:', response.status);
                }
            },
            onerror: function(error) {
                console.error('3D坦克 屏蔽词替换字典网络请求错误:', error);
            }
        });
    }

    /**
     * 处理输入事件，进行文本替换
     * @param {Event} event - 输入事件对象
     */
    function handleInput(event) {
        const target = event.target;

        // 检查事件目标是否是输入框或文本域，并且字典已成功加载
        if (!target || (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') || sortedKeys.length === 0) {
            return;
        }

        const originalValue = target.value;
        let newValue = originalValue;
        const cursorPosition = target.selectionStart; // 保存当前光标位置

        // 遍历排序后的关键词列表进行替换
        for (const key of sortedKeys) {
            // 使用 .split().join() 方法进行全局替换，比正则表达式更安全，无需转义特殊字符
            if (newValue.includes(key)) {
                newValue = newValue.split(key).join(replacementDict[key]);
            }
        }

        // 如果文本发生了变化
        if (newValue !== originalValue) {
            // 更新输入框的值
            target.value = newValue;
            // 恢复光标位置，以防光标跳到末尾
            // 注意：这在某些复杂情况下可能不完美，但对于大多数输入场景是有效的
            target.setSelectionRange(cursorPosition, cursorPosition);

            // 可选：手动触发一次input事件，以通知可能监听此输入框的其他框架或脚本
            const newEvent = new Event('input', { bubbles: true, cancelable: true });
            target.dispatchEvent(newEvent);
        }
    }

    // 脚本主程序
    // 1. 获取字典
    fetchDictionary();

    // 2. 在整个文档上监听 'input' 事件（事件委托）
    // 这比为每个输入框单独添加监听器更高效，并且能处理动态添加到页面的新输入框
    document.addEventListener('input', handleInput, true); // 使用捕获阶段确保尽早处理

    console.log('3D坦克屏蔽词替换脚本已启动。');
})();
