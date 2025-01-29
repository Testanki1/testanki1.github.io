import os
import requests
from bs4 import BeautifulSoup
from googletrans import Translator

# 目标页面和存放路径
URL = "https://en.tankiwiki.com/Tanki_Online_Wiki"
OUTPUT_DIR = "wiki"
OUTPUT_FILE = "Tanki_Online_Wiki.md"

# 设置请求头，伪装成浏览器
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.google.com/",
    "DNT": "1",
    "Connection": "keep-alive"
}

# 初始化翻译器
translator = Translator()

# 确保目录存在
os.makedirs(OUTPUT_DIR, exist_ok=True)

def fetch_and_translate(url, output_file):
    """抓取指定页面并翻译"""
    print(f"Fetching {url}...")
    response = requests.get(url, headers=HEADERS, timeout=10)
    
    if response.status_code != 200:
        print(f"Failed to fetch {url} - Status Code: {response.status_code}")
        return
    
    soup = BeautifulSoup(response.text, "lxml")

    # 仅提取主要内容区域
    content_div = soup.find("div", {"id": "mw-content-text"})
    if not content_div:
        print(f"No content found for {url}")
        return
    
    text = content_div.get_text("\n", strip=True)

    # 翻译文本
    print("Translating content...")
    translated_text = translator.translate(text, src="en", dest="zh-cn").text

    # 保存到 markdown 文件
    file_path = os.path.join(OUTPUT_DIR, output_file)
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(f"# Tanki Online Wiki\n\n")
        f.write(translated_text)

    print(f"Saved: {file_path}")

# 运行爬取和翻译
if __name__ == "__main__":
    fetch_and_translate(URL, OUTPUT_FILE)
