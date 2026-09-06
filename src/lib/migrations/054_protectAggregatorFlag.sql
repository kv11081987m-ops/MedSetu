CREATE OR REPLACE FUNCTION protect_seller_trust_columns()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (is_active_superadmin() OR is_approved_admin()) THEN
    NEW.is_verified      := OLD.is_verified;
    NEW.rating           := OLD.rating;
  END IF;

  IF NOT is_superadmin_or_delegated_admin() THEN
    NEW.commission_mode      := OLD.commission_mode;
    NEW.commission_flat_rate := OLD.commission_flat_rate;
  END IF;

  IF NOT is_active_superadmin() THEN
    NEW.is_aggregator := OLD.is_aggregator;
  END IF;

  RETURN NEW;
END;
$$;
