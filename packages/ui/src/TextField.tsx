'use client'

import './output.css'

interface TextFieldProps {
  label?: string
  id?: string
  placeholder?: string
  type?: string
  value?: string
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
}

export const TextField = ({ label, id, placeholder, type, value, onChange }: TextFieldProps) => {
  return (
    <div>
      { label && <label className="block mb-2 text-sm font-medium text-gray-900">{label}</label> }
      <div>
        <input type={type || 'text'} value={value} onChange={onChange}
          id={id}
          className="rounded w-full py-2 px-3 text-gray-700 border focus:outline-none focus:ring-0 focus:border-black"
          placeholder={placeholder} />
      </div>  
    </div>
  );
};
