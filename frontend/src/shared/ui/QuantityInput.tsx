import { useEffect, useId, useRef, useState, type InputHTMLAttributes } from "react";
import { quantityInputError, stepQuantity } from "./quantity-input-logic";
import "./quantity-input.css";

type QuantityInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue" | "onChange" | "step" | "min" | "max"> & {
  value: string;
  onValueChange: (value: string) => void;
  label?: string;
  allowZero?: boolean;
  max?: number;
};

export function QuantityInput({ value, onValueChange, label, allowZero = false, max, id, disabled, required, className, ...inputProps }: QuantityInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const inputRef = useRef<HTMLInputElement>(null);
  const [touched, setTouched] = useState(false);
  const name = inputProps["aria-label"] ?? label ?? "数量";
  const bounds = { allowZero, max };
  const error = quantityInputError(value, { required, ...bounds });
  const decrease = stepQuantity(value, -1, bounds);
  const increase = stepQuantity(value, 1, bounds);
  const showError = touched && error && !disabled;

  useEffect(() => { inputRef.current?.setCustomValidity(disabled ? "" : error); }, [disabled, error]);
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const wheel = (event: WheelEvent) => {
      if (disabled || document.activeElement !== input || event.ctrlKey || event.deltaY === 0) return;
      event.preventDefault();
      onValueChange(stepQuantity(value, event.deltaY < 0 ? 1 : -1, { allowZero, max }));
    };
    // 只在数量框已聚焦时响应滚轮，避免滚动页面误改库存。
    input.addEventListener("wheel", wheel, { passive: false });
    return () => input.removeEventListener("wheel", wheel);
  }, [allowZero, disabled, max, onValueChange, value]);

  return <div className={`pn-quantity-field${label ? " pn-quantity-field--labelled" : ""}${className ? ` ${className}` : ""}`}>
    {label && <label htmlFor={inputId}>{label}</label>}
    <div className="pn-quantity-controls">
      <button type="button" aria-label={`${name}减少 1`} title="减少 1" disabled={disabled || decrease === value} onClick={() => onValueChange(decrease)}>−</button>
      <input {...inputProps} ref={inputRef} id={inputId} type="text" inputMode="decimal" role="spinbutton"
        required={required} disabled={disabled} value={value}
        aria-invalid={showError ? true : undefined}
        aria-describedby={[inputProps["aria-describedby"], showError ? `${inputId}-error` : undefined].filter(Boolean).join(" ") || undefined}
        aria-valuemin={allowZero ? 0 : 0.000001} aria-valuemax={max ?? 999999999.999999}
        aria-valuenow={value.trim() && !error ? Number(value) : undefined}
        onChange={event => onValueChange(event.target.value)}
        onBlur={event => { inputProps.onBlur?.(event); setTouched(true); }}
        onKeyDown={event => {
          inputProps.onKeyDown?.(event);
          if (event.defaultPrevented || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
          event.preventDefault();
          onValueChange(stepQuantity(value, event.key === "ArrowUp" ? 1 : -1, bounds));
        }} />
      <button type="button" aria-label={`${name}增加 1`} title="增加 1" disabled={disabled || increase === value} onClick={() => onValueChange(increase)}>+</button>
    </div>
    {showError && <p id={`${inputId}-error`} className="form-error pn-quantity-error">{error}</p>}
  </div>;
}
