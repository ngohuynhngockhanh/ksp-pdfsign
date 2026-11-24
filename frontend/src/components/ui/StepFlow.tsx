import { Fragment, type ReactNode } from "react";
import { AppIcon } from "./Icon";

export interface StepFlowItem {
  id: string;
  label: ReactNode;
  done?: boolean;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

export interface StepFlowProps {
  steps: StepFlowItem[];
  className?: string;
  ariaLabel?: string;
}

export function StepFlow({
  steps,
  className = "",
  ariaLabel = "Tiến trình thực hiện",
}: StepFlowProps) {
  const navCls = ["ui-step-flow", className].filter(Boolean).join(" ");

  return (
    <nav className={navCls} aria-label={ariaLabel}>
      {steps.map((step, idx) => {
        const isClickable = Boolean(step.onClick && !step.disabled);
        const itemCls = [
          "ui-step-item",
          step.done ? "is-done" : "",
          step.active ? "is-active" : "",
        ]
          .filter(Boolean)
          .join(" ");

        const body = (
          <>
            <span className="ui-step-num" aria-hidden="true">
              {step.done && !step.active ? (
                <AppIcon name="check" size={14} />
              ) : (
                idx + 1
              )}
            </span>
            <span>{step.label}</span>
          </>
        );

        return (
          <Fragment key={step.id}>
            {isClickable ? (
              <button
                type="button"
                className={itemCls}
                aria-current={step.active ? "step" : undefined}
                onClick={step.onClick}
              >
                {body}
              </button>
            ) : (
              <div
                className={itemCls}
                aria-current={step.active ? "step" : undefined}
              >
                {body}
              </div>
            )}
            {idx < steps.length - 1 && (
              <span className="ui-step-sep" aria-hidden="true" />
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
