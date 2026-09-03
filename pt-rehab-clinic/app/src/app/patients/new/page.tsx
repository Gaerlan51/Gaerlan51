import { requireRole } from '@/server/session';
import { createPatientAction } from '@/server/actions';
import { Card, Field } from '@/components/ui';

export default async function NewPatientPage() {
  await requireRole('owner', 'admin');

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">Register patient</h1>
      <Card>
        <form action={createPatientAction} className="grid gap-4 sm:grid-cols-2">
          <Field label="First name"><input className="input" name="first_name" required /></Field>
          <Field label="Last name"><input className="input" name="last_name" required /></Field>
          <Field label="Date of birth"><input className="input" name="birth_date" type="date" /></Field>
          <Field label="Sex"><input className="input" name="sex" /></Field>
          <Field label="Mobile number" hint="Used for SMS reminders">
            <input className="input" name="phone" placeholder="+639…" />
          </Field>
          <Field label="Email"><input className="input" name="email" type="email" /></Field>
          <Field label="Payer type">
            <select className="input" name="payer_type" defaultValue="cash">
              <option value="philhealth">Philhealth</option>
              <option value="hmo">HMO</option>
              <option value="cash">Cash</option>
              <option value="referral">Physician referral</option>
            </select>
          </Field>
          <Field label="HMO name" hint="If payer type is HMO">
            <input className="input" name="hmo_name" />
          </Field>
          <Field label="Philhealth number"><input className="input" name="philhealth_no" /></Field>
          <div className="sm:col-span-2">
            <Field label="Address"><input className="input" name="address" /></Field>
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <button className="btn-primary">Register patient</button>
          </div>
        </form>
      </Card>
      <p className="text-xs text-slate-500">
        The patient is registered to your branch. Staff at other branches cannot see this record.
      </p>
    </div>
  );
}
