// ==UserScript==
// @name         3D坦克在线人数显示
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  显示3D坦克游戏的在线人数，支持国服、测试服，目前不支持外服
// @author       Testanki
// @match        *://*.3dtank.com/play*
// @match        *://*.test-eu.tankionline.com/*
// @match        *://*.test-ru.tankionline.com/*
// @grant        GM_xmlhttpRequest
// @connect      balancer.3dtank.com
// @connect      balancer.public-deploy1.test-eu.tankionline.com
// @connect      balancer.public-deploy2.test-eu.tankionline.com
// @connect      balancer.public-deploy3.test-eu.tankionline.com
// @connect      balancer.public-deploy4.test-eu.tankionline.com
// @connect      balancer.public-deploy5.test-eu.tankionline.com
// @connect      balancer.public-deploy6.test-eu.tankionline.com
// @connect      balancer.public-deploy7.test-eu.tankionline.com
// @connect      balancer.public-deploy8.test-eu.tankionline.com
// @connect      balancer.public-deploy9.test-eu.tankionline.com
// @connect      balancer.public-deploy10.test-eu.tankionline.com
// @connect      balancer.review-1-public.test-ru.tankionline.com
// @connect      balancer.review-2-public.test-ru.tankionline.com
// @connect      balancer.review-3-public.test-ru.tankionline.com
// @connect      balancer.review-4-public.test-ru.tankionline.com
// @connect      balancer.review-5-public.test-ru.tankionline.com
// @connect      balancer.review-6-public.test-ru.tankionline.com
// @connect      balancer.review-7-public.test-ru.tankionline.com
// @connect      balancer.review-8-public.test-ru.tankionline.com
// @connect      balancer.review-9-public.test-ru.tankionline.com
// @connect      balancer.review-10-public.test-ru.tankionline.com
// ==/UserScript==

(function() {
    'use strict';

    let url;

    const currentUrl = window.location.href;

    const urlParams = new URLSearchParams(window.location.search);
    const balancerParam = urlParams.get('balancer');

    if (balancerParam) {
        url = balancerParam;
    } else if (/^https:\/\/3dtank\.com\//.test(currentUrl)) {
        url = 'https://balancer.3dtank.com/balancer';
    } else if (/^https:\/\/public-deploy[1-10]\.test-eu\.tankionline\.com\//.test(currentUrl)) {
        const match = currentUrl.match(/^https:\/\/public-deploy([1-10])\.test-eu\.tankionline\.com\//);
        if (match) {
            url = `https://balancer.public-deploy${match[1]}.test-eu.tankionline.com/balancer`;
        }
    } else if (/^https:\/\/client-review-[1-10]-public\.test-ru\.tankionline\.com\//.test(currentUrl)) {
        const match = currentUrl.match(/^https:\/\/client-review-([1-10])\-public\.test-ru\.tankionline\.com\//);
        if (match) {
            url = `https://balancer.review-${match[1]}-public.test-ru.tankionline.com/balancer`;
        }
    }

    if (!url) {
        console.error('未找到有效的 URL，脚本将停止执行。');
        return;
    }

    const container = document.createElement('div');

    const savedPosition = JSON.parse(localStorage.getItem('onlineContainerPosition'));
    if (savedPosition) {
        container.style.left = savedPosition.left + '%';
        container.style.top = savedPosition.top + '%';
        container.style.position = 'fixed';
    } else {
        container.style.position = 'fixed';
        container.style.right = '5%';
        container.style.bottom = '5%';
    }

    container.style.backgroundColor = 'rgba(0, 25, 38, 0.7)';
    container.style.color = '#fff';
    container.style.padding = '10px';
    container.style.borderRadius = '5px';
    container.style.fontSize = '14px';
    container.style.zIndex = '10000';
    container.style.cursor = 'grab';
    container.style.border = '2px solid transparent';
    container.innerHTML = `<div>长按可调整位置</div>`;
    document.body.appendChild(container);

    function fetchAndUpdateData() {
        console.log('请求 URL:', url);
        GM_xmlhttpRequest({
            method: 'GET',
            url: url,
            responseType: 'json',
            onload: function(response) {
                if (response.status === 200) {
                    const data = response.response;

                    let totalOnline = 0;
                    let totalInBattles = 0;
                    let totalMy4399Com = 0;

                    for (let node in data.nodes) {
                        if (data.nodes.hasOwnProperty(node)) {
                            totalOnline += data.nodes[node].online || 0;
                            totalInBattles += data.nodes[node].inbattles || 0;
                            totalMy4399Com += data.nodes[node].partners.my_4399_com || 0;
                        }
                    }

                    let contentHTML = `
                        <div><strong>在线:</strong> ${totalOnline}</div>
                        <div><strong>战斗中:</strong> ${totalInBattles}</div>
                    `;

                    if (url === 'https://balancer.3dtank.com/balancer') {
                        contentHTML += `<div><strong>4399:</strong> ${totalMy4399Com}</div>`;
                    }

                    contentHTML += `<div style="font-size: 10px;">长按可调整位置</div>`;
                    container.innerHTML = contentHTML;
                } else {
                    console.error('获取在线人数数据失败:', response.statusText);
                    container.innerHTML = `<div>获取数据时出错</div>`;
                }
            },
            onerror: function(err) {
                console.error('获取在线人数数据时发生错误:', err);
                container.innerHTML = `<div>获取数据时出错</div>`;
            }
        });
    }

    fetchAndUpdateData();
    setInterval(fetchAndUpdateData, 11000);

    let isDragging = false;
    let startX, startY, offsetX, offsetY, dragTimeout;

    function startDragging(clientX, clientY) {
        dragTimeout = setTimeout(() => {
            isDragging = true;
            container.style.cursor = 'grabbing';
            container.style.border = '2px solid #76ff33';
            startX = clientX;
            startY = clientY;
            offsetX = container.offsetLeft;
            offsetY = container.offsetTop;
        }, 800);
    }

    container.addEventListener('mousedown', function(e) {
        if (e.detail === 2) {
            fetchAndUpdateData();
            return;
        }
        startDragging(e.clientX, e.clientY);
    });

    container.addEventListener('touchstart', function(e) {
        const touch = e.touches[0];
        startDragging(touch.clientX, touch.clientY);
    });

    document.addEventListener('mousemove', function(e) {
        if (isDragging) {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            const newLeft = offsetX + dx;
            const newTop = offsetY + dy;
            container.style.left = newLeft + 'px';
            container.style.top = newTop + 'px';
            container.style.right = 'auto';
            container.style.bottom = 'auto';

            const rect = container.getBoundingClientRect();
            const screenWidth = window.innerWidth;
            const screenHeight = window.innerHeight;

            if (rect.right > screenWidth) {
                container.style.left = (screenWidth - rect.width) + 'px';
            }
            if (rect.bottom > screenHeight) {
                container.style.top = (screenHeight - rect.height) + 'px';
            }
            if (rect.left < 0) {
                container.style.left = '0';
                container.style.right = 'auto';
            }
            if (rect.top < 0) {
                container.style.top = '0';
                container.style.bottom = 'auto';
            }
        }
    });

    document.addEventListener('touchmove', function(e) {
        if (isDragging) {
            const touch = e.touches[0];
            const dx = touch.clientX - startX;
            const dy = touch.clientY - startY;
            const newLeft = offsetX + dx;
            const newTop = offsetY + dy;
            container.style.left = newLeft + 'px';
            container.style.top = newTop + 'px';
            container.style.right = 'auto';
            container.style.bottom = 'auto';
            e.preventDefault();

            const rect = container.getBoundingClientRect();
            const screenWidth = window.innerWidth;
            const screenHeight = window.innerHeight;

            if (rect.right > screenWidth) {
                container.style.left = (screenWidth - rect.width) + 'px';
            }
            if (rect.bottom > screenHeight) {
                container.style.top = (screenHeight - rect.height) + 'px';
            }
            if (rect.left < 0) {
                container.style.left = '0';
                container.style.right = 'auto';
            }
            if (rect.top < 0) {
                container.style.top = '0';
                container.style.bottom = 'auto';
            }
        }
    });

    function stopDragging() {
        if (isDragging) {
            isDragging = false;
            container.style.cursor = 'grab';
            container.style.border = '2px solid transparent';

            const screenWidth = window.innerWidth;
            const screenHeight = window.innerHeight;
            const rect = container.getBoundingClientRect();

            localStorage.setItem('onlineContainerPosition', JSON.stringify({
                left: (rect.left / screenWidth) * 100,
                top: (rect.top / screenHeight) * 100
            }));
        }
        clearTimeout(dragTimeout);
    }

    document.addEventListener('mouseup', stopDragging);
    document.addEventListener('touchend', stopDragging);
    container.addEventListener('mouseleave', function() {
        clearTimeout(dragTimeout);
    });

    window.addEventListener('resize', function() {
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;
        const rect = container.getBoundingClientRect();
        
        if (rect.right > screenWidth) {
            container.style.left = (screenWidth - rect.width) + 'px';
        }
        if (rect.bottom > screenHeight) {
            container.style.top = (screenHeight - rect.height) + 'px';
        }
        if (rect.left < 0) {
            container.style.left = '0';
            container.style.right = 'auto';
        }
        if (rect.top < 0) {
            container.style.top = '0';
            container.style.bottom = 'auto';
        }
    });

})();
