import type {H3Event} from "h3";
import {readBody} from "h3";
import {z} from "zod";
import {normalizeValidationIssues} from "../../shared/validation-issues";
import {
    ChangePasswordRequestDtoSchema,
    LoginRequestDtoSchema,
    OAuthRegisterRequestDtoSchema,
    RegisterRequestDtoSchema,
    UpdateProfileRequestDtoSchema,
} from "../../shared/auth-server-schema";
import {apiError} from "./api-error";

export {
    ChangePasswordRequestDtoSchema,
    LoginRequestDtoSchema,
    OAuthRegisterRequestDtoSchema,
    RegisterRequestDtoSchema,
    UpdateProfileRequestDtoSchema,
};

/** 统一解析并校验 JSON body。 */
export async function validateBody<T>(event: H3Event, schema: z.ZodType<T>): Promise<T> {
    const result = schema.safeParse(await readBody(event));
    if (!result.success) {
        throw apiError(400, "validation_failed", "Request validation failed", {
            issues: normalizeValidationIssues(result.error.issues),
        });
    }
    return result.data;
}
