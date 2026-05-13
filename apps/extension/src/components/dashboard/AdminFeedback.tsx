type AdminFeedbackProps = {
  error: string | null;
  message: string | null;
};

export const AdminFeedback = ({ error, message }: AdminFeedbackProps) =>
  message || error ? <section className={`ae-admin-feedback ${error ? "error" : "success"}`}>{error ?? message}</section> : null;
