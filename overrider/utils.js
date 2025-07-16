const getCategory = (element) => {
    for (const [category, items] of categories) {
        if (items.includes(element)) {
            return category;
        }
    }
    return null;
};
const setSkin = (element, skin) => {
    const category = getCategory(element);
    if (!category || !defaultTextures[element]) {
        console.warn(`[Overrider] Unknown element: ${element}`);
        return;
    }
    resourcesOverrider.push(
        ...filenames.map(file => {
            if (file === "tracks.webp" && (skin === "LC" || skin === "XT")) return null;
            const toFile = (file === "tracks.webp" && skin === "GT") ? "wheels.webp" : file;
            return {
                from: `${defaultTextures[element]}/${file}`,
                to: baseToUrl
                    .replace("{folder}", category)
                    .replace("{element}", element)
                    .replace("{skin}", skin)
                    .replace("{file}", toFile),
                comment: `${element} -> ${skin} | ${file} -> ${toFile}`
            };
        }).filter(Boolean)
    );
};
const createPattern = url => new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
