"use client";

const LoadingSpinner = () => {
  return (
    <div className="flex justify-center items-center my-4">
      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      <span className="ml-3 text-blue-600 font-semibold">Cargando órdenes...</span>
    </div>
  );
};

export default LoadingSpinner;
