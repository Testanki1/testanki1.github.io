import os
import time
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from webdriver_manager.chrome import ChromeDriverManager
from deep_translator import GoogleTranslator
from bs4 import BeautifulSoup

# 目标页面和存放路径
URL = "https://en.tankiwiki.com/Tanki_Online_Wiki"
OUTPUT_DIR = "wiki"
OUTPUT_FILE = "Tanki_Online_Wiki.html"  # 生成 HTML 文件

# 初始化翻译器
translator = GoogleTranslator(source="en", target="zh-cn")

# 配置 Selenium WebDriver
options = webdriver.ChromeOptions()
options.add_argument("--headless")  # 无头模式
options.add_argument("--disable-gpu")
options.add_argument("--no-sandbox")
options.add_argument("--disable-software-rasterizer")

# 启动 Selenium WebDriver
driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)

def translate_text(text):
    """使用 Google 翻译文本"""
    if not text.strip():  # 空文本不翻译
        return text
    try:
        return translator.translate(text)
    except Exception as e:
        print(f"翻译失败: {e}")
        return text  # 翻译失败时，保留原文本

def fetch_and_translate(url, output_file):
    """完整爬取网页 HTML 并翻译正文内容"""
    print(f"Fetching {url}...")
    driver.get(url)
    time.sleep(5)  # 等待页面加载完毕

    # 获取完整 HTML 结构
    soup = BeautifulSoup(driver.page_source, "html.parser")

    # 遍历所有文本节点并翻译（使用 string=True 修复警告）
    for tag in soup.find_all(string=True):
        if tag.parent.name not in ["script", "style", "meta", "link"]:  # 跳过非正文内容
            translated_text = translate_text(tag.string)
            tag.replace_with(translated_text)

    # 确保保存路径存在
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    file_path = os.path.join(OUTPUT_DIR, output_file)

    # 保存完整 HTML 文件
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(str(soup.prettify()))  # 美化 HTML 结构

    print(f"Saved: {file_path}")

# 运行爬取和翻译
if __name__ == "__main__":
    fetch_and_translate(URL, OUTPUT_FILE)

# 关闭浏览器
driver.quit()
