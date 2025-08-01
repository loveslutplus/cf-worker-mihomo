import { fetchResponse, splitUrlsAndProxies, buildApiUrl, Top_Data, Rule_Data, udp } from './utils.js';
export async function getmihomo_config(urls, rule, top, userAgent, subapi) {
    if (!/meta|clash.meta|clash|clashverge|mihomo/i.test(userAgent)) {
        throw new Error('不支持的客户端');
    }
    urls = splitUrlsAndProxies(urls);
    const [Mihomo_Top_Data, Mihomo_Rule_Data, Mihomo_Proxies_Data] = await Promise.all([
        Top_Data(top),
        Rule_Data(rule),
        getMihomo_Proxies_Data(urls, userAgent, subapi)
    ]);
    if (!Mihomo_Proxies_Data?.data?.proxies || Mihomo_Proxies_Data?.data?.proxies?.length === 0) throw new Error('节点为空');
    Mihomo_Rule_Data.data.proxies = [...(Mihomo_Rule_Data?.data?.proxies || []), ...Mihomo_Proxies_Data?.data?.proxies];
    Mihomo_Rule_Data.data['proxy-groups'] = getMihomo_Proxies_Grouping(Mihomo_Proxies_Data.data, Mihomo_Rule_Data.data);
    Mihomo_Top_Data.data['proxy-providers'] = Mihomo_Proxies_Data?.data?.providers;
    applyTemplate(Mihomo_Top_Data.data, Mihomo_Rule_Data.data);
    return {
        status: Mihomo_Proxies_Data.status,
        headers: Mihomo_Proxies_Data.headers,
        data: JSON.stringify(Mihomo_Top_Data.data, null, 4)
    };
}
/**
 * 随机从多个订阅 URL 中获取其响应头中的 subscription-userinfo 信息
 * 如果只有一个 URL，直接返回其 subscription-userinfo
 * @param {string[]} urls - 订阅地址列表
 * @param {string} userAgent - 请求头中的 User-Agent 字段
 * @returns {Promise<{status: number, headers: Object, data: any}>} - 包含状态码、响应头和 subscription-userinfo 字符串
 */
export async function getMihomo_Proxies_Data(urls, userAgent, subapi) {
    let res
    if (urls.length === 1) {
        res = await fetchResponse(urls[0], userAgent);
        if (res?.data?.proxies && Array.isArray(res?.data?.proxies) && res?.data?.proxies?.length > 0) {
            res.data.proxies.forEach((p) => {
                if (udp) p.udp = true;
            });
            return {
                status: res.status,
                headers: res.headers,
                data: res.data
            };
        } else {
            const apiurl = buildApiUrl(urls[0], subapi, 'clash');
            res = await fetchResponse(apiurl, userAgent);
            if (res?.data?.proxies && Array.isArray(res?.data?.proxies) && res?.data?.proxies?.length > 0) {
                res.data.proxies.forEach((p) => {
                    if (udp) p.udp = true;
                });
                return {
                    status: res.status,
                    headers: res.headers,
                    data: res.data
                };
            }
        }
    } else {
        const proxies_list = [];
        const hesList = [];
        for (let i = 0; i < urls.length; i++) {
            let res = await fetchResponse(urls[i], userAgent);
            if (res?.data && Array.isArray(res?.data?.proxies)) {
                res.data.proxies.forEach((p) => {
                    p.name = `${p.name} [${i + 1}]`;
                    if (udp) p.udp = true;
                });
                hesList.push({
                    status: res.status,
                    headers: res.headers,
                });
                proxies_list.push(...res.data.proxies);
            } else {
                const apiurl = buildApiUrl(urls[i], subapi, 'clash');
                res = await fetchResponse(apiurl, userAgent);
                if (res?.data?.proxies && Array.isArray(res?.data?.proxies)) {
                    res.data.proxies.forEach((p) => {
                        p.name = `${p.name} [${i + 1}]`;
                        if (udp) p.udp = true;
                    });
                    hesList.push({
                        status: res.status,
                        headers: res.headers,
                    });
                    proxies_list.push(...res.data.proxies);
                }
            }
        }
        const randomIndex = Math.floor(Math.random() * hesList.length);
        const hes = hesList[randomIndex];
        const data = { providers: {}, proxies: proxies_list };
        return {
            status: hes.status,
            headers: hes.headers,
            data: data
        };
    }
}
/**
 * 将模板中的 proxies、proxy-groups、rules 等字段合并到目标配置对象
 * @param {Object} target - 目标配置对象（基础配置）
 * @param {Object} template - 模板配置对象
 */
export function applyTemplate(top, rule) {
    top.proxies = rule.proxies || [];
    top['proxy-groups'] = rule['proxy-groups'] || [];
    top.rules = rule.rules || [];
    top['sub-rules'] = rule['sub-rules'] || {};
    top['rule-providers'] = { ...(top['rule-providers'] || {}), ...(rule['rule-providers'] || {}) };
}

/**
 * 获取 Mihomo 代理分组信息
 * @param {Array} proxies - 代理列表
 * @param {Array} groups - 策略组
 * @returns {Object} 分组信息
 */
export function getMihomo_Proxies_Grouping(proxies, groups) {
    const deletedGroups = []; // 用于记录已删除的组名
    const updatedGroups = groups["proxy-groups"].filter(group => {
        let matchFound = false;

        // 确保 filter 存在并且是一个字符串
        let filter = group.filter;
        if (typeof filter === 'string' && filter.startsWith("(?i)")) {
            filter = filter.slice(4); // 去掉 (?i) 部分
        }

        // 如果 filter 不存在或不是字符串，直接跳过该组
        if (typeof filter !== 'string') {
            return true; // 保留没有 filter 的组
        }

        const regex = new RegExp(filter, 'i');  // 将 'i' 标志作为第二个参数传递

        // 遍历每个代理，检查是否与当前组的正则匹配
        for (let proxy of proxies.proxies) {
            if (regex.test(proxy.name)) {
                matchFound = true;
                break;
            }
        }

        // 如果没有匹配，记录删除的组并返回 false (删除该组)
        if (!matchFound) {
            deletedGroups.push(group.name);
            return false;
        }

        return true;
    });

    // 遍历所有策略组，删除 deletedGroups 中的代理
    updatedGroups.forEach(group => {
        if (group.proxies) {
            group.proxies = group.proxies.filter(proxyName => {
                // 只删除那些在 deletedGroups 中的代理
                return !deletedGroups.some(deletedGroup => {
                    return deletedGroup.includes(proxyName); // 检查 deletedGroups 中是否包含该代理名称
                });
            });
        }
    });

    return updatedGroups;
}