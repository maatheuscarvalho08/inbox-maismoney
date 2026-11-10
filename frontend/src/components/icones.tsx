import type { ComponentType } from "react";
import * as P from "@phosphor-icons/react";

// Único ponto de entrada de ícones do sistema. Duotone dá personalidade aos ícones maiores;
// abaixo de 14px o duotone embola, então eles e os ícones de ação usam o peso bold.
export interface IconeProps {
  size?: number;
  className?: string;
  weight?: P.IconWeight;
  strokeWidth?: number;
  "aria-hidden"?: boolean | "true" | "false";
}
export type Icone = ComponentType<IconeProps>;

function criar(Base: P.Icon, sempreBold = false): Icone {
  return function IconeMarca({ size = 16, weight, strokeWidth: _ignorado, ...resto }: IconeProps) {
    return <Base size={size} weight={weight ?? (sempreBold || size < 14 ? "bold" : "duotone")} {...resto} />;
  };
}

export const ArrowDown = criar(P.ArrowDown, true);
export const ArrowLeft = criar(P.ArrowLeft, true);
export const ArrowRight = criar(P.ArrowRight, true);
export const ArrowUp = criar(P.ArrowUp, true);
export const BarChart2 = criar(P.ChartBar);
export const Bell = criar(P.BellRinging);
export const Bot = criar(P.Robot);
export const Calculator = criar(P.Calculator);
export const Camera = criar(P.Camera);
export const Check = criar(P.Check, true);
export const CheckCheck = criar(P.Checks, true);
export const CheckCircle2 = criar(P.CheckCircle);
export const ChevronDown = criar(P.CaretDown, true);
export const CircleAlert = criar(P.WarningCircle);
export const CircleDot = criar(P.CircleHalf);
export const Clock = criar(P.Clock);
export const Download = criar(P.DownloadSimple);
export const Eye = criar(P.Eye);
export const EyeOff = criar(P.EyeSlash);
export const FileText = criar(P.FileText);
export const Filter = criar(P.Funnel);
export const Inbox = criar(P.Tray);
export const Info = criar(P.Info);
export const LayoutDashboard = criar(P.SquaresFour);
export const Loader2 = criar(P.CircleNotch, true);
export const Lock = criar(P.Lock);
export const LogIn = criar(P.SignIn);
export const Mail = criar(P.EnvelopeSimple);
export const Megaphone = criar(P.Megaphone);
export const MessageSquare = criar(P.ChatsCircle);
export const Mic = criar(P.Microphone);
export const MoreVertical = criar(P.DotsThreeVertical, true);
export const Paperclip = criar(P.Paperclip);
export const Pause = criar(P.Pause);
export const Pencil = criar(P.PencilSimple);
export const Percent = criar(P.Percent);
export const Phone = criar(P.Phone);
export const PhoneCall = criar(P.PhoneCall);
export const Play = criar(P.Play);
export const Plus = criar(P.Plus, true);
export const Reply = criar(P.ArrowBendUpLeft, true);
export const Search = criar(P.MagnifyingGlass);
export const Send = criar(P.PaperPlaneTilt);
export const Settings = criar(P.GearSix);
export const ShoppingCart = criar(P.ShoppingCartSimple);
export const Smartphone = criar(P.DeviceMobile);
export const Square = criar(P.Square);
export const Tag = criar(P.Tag);
export const TrendingUp = criar(P.TrendUp);
export const TriangleAlert = criar(P.Warning);
export const Upload = criar(P.UploadSimple);
export const User = criar(P.User);
export const UserCheck = criar(P.UserCheck);
export const Users = criar(P.UsersThree);
export const X = criar(P.X, true);
