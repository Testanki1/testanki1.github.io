// 添加返回按钮的功能
if (document.referrer.includes('testanki1.github.io')) {
    const backButton = document.createElement('button');
    backButton.textContent = '返回';
    backButton.style.position = 'fixed';
    backButton.style.top = '10px';
    backButton.style.left = '10px';
    backButton.style.padding = '5px 10px';
    backButton.style.border = 'none';
    backButton.style.background = '#76FF33';
    backButton.style.color = 'black';
    backButton.style.borderRadius = '10px';
    backButton.style.cursor = 'pointer';
    backButton.addEventListener('click', function() {
        history.back();
    });
    document.body.appendChild(backButton);
}
