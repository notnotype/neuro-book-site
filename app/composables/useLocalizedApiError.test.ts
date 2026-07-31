import {afterEach, describe, expect, it, vi} from "vitest";
import {useLocalizedApiError} from "./useLocalizedApiError";

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("useLocalizedApiError", () => {
    it("captures only stable error fields and classifies by code", () => {
        vi.stubGlobal("useI18n", () => ({
            t: (key: string) => key,
            te: () => false,
        }));
        const localized = useLocalizedApiError();
        const secret = "never-copy-this-value";
        const error = {
            message: secret,
            response: {
                status: 404,
                headers: new Headers({"x-request-id": "request-123"}),
                _data: {
                    data: {
                        error: "oauth_registration_missing",
                        field: "registrationCode",
                        issues: [{path: "registrationCode", code: "required", minimum: 1, message: secret}],
                    },
                },
            },
        };

        const snapshot = localized.snapshot(error);
        expect(snapshot).toEqual({
            kind: "api_error_snapshot",
            errorCode: "oauth_registration_missing",
            field: "registrationCode",
            issues: [{path: "registrationCode", code: "required", minimum: 1}],
            status: 404,
            requestId: "request-123",
        });
        expect(localized.hasCode(snapshot, "oauth_registration_missing")).toBe(true);
        expect(JSON.stringify(snapshot)).not.toContain(secret);
    });

    it("drops unknown issue codes from an untrusted response", () => {
        vi.stubGlobal("useI18n", () => ({t: (key: string) => key, te: () => false}));
        const localized = useLocalizedApiError();
        const snapshot = localized.snapshot({data: {data: {error: "validation_failed", issues: [
            {path: "username", code: "server_internal_message"},
        ]}}});

        expect(snapshot.issues).toEqual([]);
    });
});
