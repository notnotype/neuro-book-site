import {setResponseStatus} from "h3";
import {inspectReadiness} from "../../utils/readiness";

/** 检查数据库、migration、持久目录和容量；阻断项失败时返回 503。 */
export default defineEventHandler(async (event) => {
    const result = await inspectReadiness();
    if (result.status === "not_ready") {
        setResponseStatus(event, 503);
    }
    return result;
});
