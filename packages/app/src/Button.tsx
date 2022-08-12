import classNames from "classnames";
import { ButtonHTMLAttributes, DetailedHTMLProps } from "react";

import { PendingIcon } from "./PendingIcon";

const buttonClasses =
  "self-center transition text-white bg-sky-600 hover:bg-cyan-600 active:bg-cyan-700 disabled:bg-slate-400 px-6 py-3 rounded-lg text-xl flex";

type Props = {
  children: React.ReactNode;
  pending?: boolean;
};

type ButtonProps = Props &
  DetailedHTMLProps<ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement>;

export const Button = ({
  pending,
  type,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) => {
  return (
    <button
      type={type || "button"}
      className={classNames(buttonClasses, className)}
      disabled={disabled || pending}
      {...props}
    >
      {children}
      {pending ? (
        <span className="self-center ml-2 -mr-1">
          <PendingIcon />
        </span>
      ) : null}
    </button>
  );
};
