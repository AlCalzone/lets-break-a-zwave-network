import type { ButtonHTMLAttributes } from "react";
import "./controls.css";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  primary?: boolean;
  wide?: boolean;
}

export function Button({
  primary = false,
  wide = false,
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={`zc-btn demo-button${primary ? " is-primary" : ""}${wide ? " is-wide" : ""} ${className}`}
    />
  );
}
