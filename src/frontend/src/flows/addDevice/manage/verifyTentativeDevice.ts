import { html, render } from "lit-html";
import { unreachableLax, unknownToString } from "../../../utils/utils";
import { createRef, ref } from "lit-html/directives/ref.js";
import { asyncReplace } from "lit-html/directives/async-replace.js";
import { withRef } from "../../../utils/lit-html";
import { AuthenticatedConnection } from "../../../utils/iiConnection";
import { withLoader } from "../../../components/loader";
import { displayError } from "../../../components/displayError";
import { Chan } from "../../../utils/utils";
import { AsyncCountdown } from "../../../utils/countdown";
import { mainWindow } from "../../../components/mainWindow";
import { VerifyTentativeDeviceResponse } from "../../../../generated/internet_identity_types";

// The type that we return, pretty much the result of the canister
// except that all retries have been exhausted
type VerifyResult =
  | Exclude<VerifyTentativeDeviceResponse, { wrong_code: unknown }>
  | { too_many_attempts: null };

// A helper type for the page verification function where a retry may be possible/requested
type VerifyResultOrRetry = VerifyResult | { retry: null };

const verifyTentativeDeviceTemplate = ({
  alias,
  remaining,
  verify,
  doContinue,
  cancel,
}: {
  alias: string;
  remaining: AsyncIterable<string>;
  cancel: () => void;
  verify: (value: string) => Promise<VerifyResultOrRetry>;
  doContinue: (result: VerifyResult) => void;
}) => {
  // The error shown on failed verification
  const showRetryPrompt = new Chan<boolean>(false);
  const retryPromptHidden = showRetryPrompt.map((showRetry) =>
    showRetry ? "" : "is-hidden"
  );

  // The error shown on bad input (e.g. "")
  const badInput = new Chan<"ok" | "bad">("ok");
  const hasError = badInput.map((e) => (e === "bad" ? "has-error" : ""));

  const pinInput = createRef<HTMLInputElement>();

  // When submitting, we either give visual feedback on bad input (e.g. "") or we
  // use the provided verification function to decide whether to retry or contine by forwarding
  // the result.
  const submit = () => {
    withRef(pinInput, async (pin) => {
      const value = pin.value;
      if (value === "") {
        badInput.send("bad");
      } else {
        showRetryPrompt.send(false);
        badInput.send("ok");

        const result = await verify(value);
        if ("retry" in result) {
          showRetryPrompt.send(true);
        } else {
          doContinue(result);
        }
      }
    });
  };

  const pageContentSlot = html`<h1 class="t-title t-title--main">
      Do you trust this device with your Identity Anchor?
    </h1>
    <output class="c-input c-input--readonly t-vip t-vip--small"
      >${alias}</output
    >
    <p class="t-paragraph">
      If you trust this device to use and manage your Internet Identity, enter
      the <strong class="t-strong">Verification Code</strong> displayed on your
      new device:
    </p>
    <label class="l-stack" aria-label="Verification Code">
      <p class="t-paragraph ${asyncReplace(retryPromptHidden)}">
        The entered verification code was invalid. Please try again.
      </p>
      <input
        ${ref(pinInput)}
        @keypress=${(e: KeyboardEvent) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        id="tentativeDeviceCode"
        class="c-input ${asyncReplace(hasError)}"
        placeholder="Verification Code"
      />
    </label>
    <p class="t-paragraph">
      Time remaining: <span class="t-strong">${asyncReplace(remaining)}</span>
    </p>

    <div class="l-stack">
      <button @click=${() => submit()} id="verifyDevice" class="c-button">
        Verify Device
      </button>
      <button @click=${() => cancel()} class="c-button c-button--secondary">
        Cancel
      </button>
    </div>`;

  return mainWindow({
    showLogo: false,
    showFooter: false,
    slot: pageContentSlot,
  });
};

export const verifyTentativeDevicePage = (
  props: Parameters<typeof verifyTentativeDeviceTemplate>[0],
  container?: HTMLElement
): void => {
  const contain =
    container ?? (document.getElementById("pageContent") as HTMLElement);
  render(verifyTentativeDeviceTemplate(props), contain);
};

/**
 * Page to verify the tentative device: the device verification code can be entered and is the checked on the canister.
 * @param connection authenticated II connection
 * @param alias of the tentative device to be verified
 * @param endTimestamp timestamp when the registration mode expires
 */
export const verifyTentativeDevice = async ({
  connection,
  alias,
  endTimestamp,
}: {
  connection: AuthenticatedConnection;
  alias: string;
  endTimestamp: bigint;
}): Promise<void> => {
  const countdown = AsyncCountdown.fromNanos(endTimestamp);

  // The verification page
  const verification = new Promise<VerifyResult | { canceled: null }>(
    (resolve) =>
      verifyTentativeDevicePage({
        alias,
        cancel: async () => {
          await withLoader(() => connection.exitDeviceRegistrationMode());
          // NOTE: we resolve before stopping the countdown to avoid Promise.race below
          // thinking it was a "stop-by-timeout"
          resolve({ canceled: null });
          countdown.stop();
        },

        // To verify the code, we query the canister, and return _except_ if the code is wrong
        // _and_ there are some attemps left, in which case we update the UI and prompt the user
        // to try again.
        verify: async (value: string): Promise<VerifyResultOrRetry> => {
          const result = await withLoader(() =>
            connection.verifyTentativeDevice(value)
          );

          if ("wrong_code" in result) {
            if (result.wrong_code.retries_left === 0) {
              return { too_many_attempts: null };
            } else {
              return { retry: null };
            }
          } else {
            return result;
          }
        },
        doContinue: resolve,
        remaining: countdown.remainingFormattedAsync(),
      })
  );

  // A timeout promise, that returns
  const timeout = async () => {
    await countdown.wait();
    return { timeout: null };
  };

  // We race the verification with the timeout to set a time limit
  const result = await Promise.race([timeout(), verification]);

  // We handle the result and yield back control
  return handleVerifyResult(result);
};

const handleVerifyResult = async (
  result: VerifyResult | { canceled: null } | { timeout: null }
) => {
  // If the verification worked or the user canceled, then we don't show anything special
  if ("verified" in result || "canceled" in result) {
    return;
  }

  // otherwise it's an error, and we tell the user what happened
  const showError = ({ title, message }: { title: string; message: string }) =>
    displayError({ title, message, primaryButton: "Ok" });

  if ("too_many_attempts" in result) {
    await showError({
      title: "Too Many Wrong Verification Codes Entered",
      message:
        "Adding the device has been aborted due to too many invalid code entries.",
    });
  } else if ("device_registration_mode_off" in result) {
    await showError({
      title: "Device Registration Not Enabled",
      message:
        "Verification not possible because device registration is no longer enabled. Either the timeout has been reached or device registration was disabled using another device.",
    });
  } else if ("timeout" in result) {
    await showError({
      title: "Timeout Reached",
      message:
        'The timeout has been reached. For security reasons the "add device" process has been aborted.',
    });
  } else if ("no_device_to_verify" in result) {
    await showError({
      title: "No Device To Verify",
      message:
        "Verification not possible because the device is no longer in a state to be verified.",
    });
  } else {
    await displayError({
      title: "Something Went Wrong",
      message: "Device could not be verified.",
      detail: unknownToString(result, "unknown data"),
      primaryButton: "Continue",
    });

    // If something really unexpected happens then we just return control to the caller
    unreachableLax(result);
  }
};
