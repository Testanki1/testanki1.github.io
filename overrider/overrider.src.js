const resourcesOverrider = [];
const originalFetch = unsafeWindow.fetch;
unsafeWindow.fetch = async (url, options) => {
    const override = resourcesOverrider.find(override => createPattern(override.from).test(url));
    if (override) {
        try {
            const response = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: override.to,
                    responseType: 'blob',
                    onload: (res) => res.status === 200 ? resolve(res) : reject(res),
                    onerror: reject
                });
            });
            console.info(`[Overrider] Resource overridden successfully.\nFrom: ${override.from}\nTo: ${override.to}\nComment: ${override.comment}`);
            return new Response(response.response, {
                status: 200,
                statusText: 'OK',
                headers: { 'Content-Type': response.response.type }
            });
        } catch (error) {
            console.error(`[Overrider] Failed to load resource.\nLink: ${override.to}\nComment: ${override.comment}\nStatus: ${error.status}`);
            throw error;
        }
    }
    return await originalFetch(url, options);
};
